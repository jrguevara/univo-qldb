# Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify,
# merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
# PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
# SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import amazon.ion.simpleion as ion
import base64
from aws_kinesis_agg.deaggregator import deaggregate_records
import boto3
import os
from botocore.exceptions import ClientError
import sys
import logging
import rds_config
import pymysql
from pyion2json import ion_to_json
import json
from pymysql.constants import CLIENT

rds_host = os.environ['RDS_HOST']
db_name = os.environ['DB_NAME']
name = rds_config.db_username
password = rds_config.db_password
schema = rds_config.schema 

REVISION_DETAILS_RECORD_TYPE = "REVISION_DETAILS"
BLOCK_SUMMARY_RECORD_TYPE = "BLOCK_SUMMARY"
PERSON_TABLENAME = "Person"
VEHICLE_REGISTRATION_TABLENAME = "VehicleRegistration"

RETRYABLE_ERRORS = ['ThrottlingException', 'ServiceUnavailable', 'RequestExpired']

logger = logging.getLogger()
logger.setLevel(logging.INFO)


try:
    conn = pymysql.connect(rds_host, user=name, passwd=password, db=db_name, connect_timeout=5, client_flag = CLIENT.MULTI_STATEMENTS, autocommit=False)
except pymysql.MySQLError as e:
    logger.error("ERROR: Unexpected error: Could not connect to MySQL instance.")
    logger.error(e)
    sys.exit()


logger.info("SUCCESS: Connection to RDS MySQL instance succeeded")



def lambda_handler(event, context):
    just_user_view = os.environ['HISTORY']
    order = os.environ['ORDER']
    load_db = False
    desc_db = False  
    #return "done"
    """
    Triggered for a batch of kinesis records.
    Parses QLDB Journal streams and  sends an SNS notification for Person and Vehicle Registration Events.
    """
    if load_db:
        _ = load_schema()
    if desc_db:
        _ = desc_db_f()
    #exit() 
    raw_kinesis_records = event['Records']
    records = deaggregate_records(raw_kinesis_records)
    print('records')
    print(records)
    item_count = 0
    # Iterate through deaggregated records
    for record in records:

        # Kinesis data in Python Lambdas is base64 encoded
        payload = base64.b64decode(record['kinesis']['data'])
        # payload is the actual ion binary record published by QLDB to the stream
        ion_record = ion.loads(payload)
        print("Ion reocord: ", (ion.dumps(ion_record, binary=False)))

        if (("recordType" in ion_record) and (ion_record["recordType"] == REVISION_DETAILS_RECORD_TYPE)):

            revision_data, revision_metadata = get_data_metdata_from_revision_record(ion_record)
            table_info = get_table_info_from_revision_record(ion_record)
            table_name = table_info['tableName']
            doc_id = revision_metadata['id']
            doc_v = revision_metadata['version']
            col = f'(DocID, DocV, '
            val = f'("{doc_id}", "{doc_v}", '
            
            if not revision_data:
                print(ion_to_json(revision_metadata))
                deletebool_statement = f'SELECT max(docv) FROM {table_name.lower()} WHERE docid = "{doc_id}" FOR UPDATE'
                replace_statement = f'replace into {table_name.lower()} (docid, docv, deletebool) values ("{doc_id}","{doc_v}",1)'
                try:
                    with conn.cursor() as cur:
                        cur.execute(deletebool_statement)
                        delete_check = cur.fetchone()
                        if int(delete_check[0]) < int(doc_v):
                            if order == 'True' and int(delete_check[0])+1 == int(doc_v):
                                cur.execute(replace_statement)
                            elif order == 'True' and int(delete_check[0])+1 != int(doc_v):
                                raise
                            elif order == 'False':
                                cur.execute(replace_statement)
                            else:
                                raise
                    conn.commit()
                except pymysql.Error as e:
                    print(e)
                    raise
            elif revision_data:
                # create sql statement
                for pair in revision_data:
                    col += f'{pair}, '
                    if f'{json.dumps(ion_to_json(revision_data[pair]))}, '[0] == '"':
                        val += '"{0}", '.format(json.dumps(ion_to_json(revision_data[pair])).replace('"',"").replace("'","")) 
                    else:
                        val += '"{0}", '.format(json.dumps(ion_to_json(revision_data[pair])).replace('"',"").replace("'",""))
                col = col[:-2] + ")"
                val = val[:-2] + ")"
                update_set = ''
                for pair in revision_data:
                    update_set += f'{pair} = {revision_data[pair]},'
                    
                update_set = update_set[:-1]
                delete_version_bool = None
                delete_version_num = -1
                try:
                    with conn.cursor() as cur:
                        statement = f'replace into {table_name.lower()} {col.lower()} values {val}'
                        #update_statement = f'UPDATE {table_name.lower()} set {update_set} WHERE docid = "{doc_id}" and docv < {doc_v}'
                        if just_user_view == 'False':
                            check = f'SELECT max(docv) FROM {table_name.lower()} WHERE docid = "{doc_id}" FOR UPDATE'
                            cur.execute(check)
                            select_check = cur.fetchone()
                            print(select_check)
                            if select_check[0] == None:
                                #delete_version_bool = False
                                if order == 'True' and int(doc_v) == 1:
                                    cur.execute(statement)
                                elif order == 'True' and int(doc_v) > 1:
                                    raise
                                elif order == 'False':
                                    cur.execute(statement)
                                else:
                                    raise
                            elif select_check[0] != None:
                                #delete_version_bool = True
                                delete_version_num = int(select_check[0])
                                if order == 'False':
                                    if delete_version_num > -1 and delete_version_num < int(doc_v):
                                        print('insert then delete')
                                        print(ion_to_json(ion_record))
                                        cur.execute(statement)
                                    elif delete_version_num > int(doc_v):
                                        print('out of order: passed')
                                        print(ion_to_json(ion_record))
                                    elif delete_version_num == int(doc_v):
                                        print('duplicate: passed')
                                        print(ion_to_json(ion_record))
                                    else:
                                        raise
                                elif order == 'True':
                                    if delete_version_num > -1 and delete_version_num + 1 == int(doc_v):
                                        print('insert then delete')
                                        print(ion_to_json(ion_record))
                                        cur.execute(statement)
                                    elif delete_version_num > int(doc_v):
                                        print('out of order: passed')
                                        print(ion_to_json(ion_record))
                                        raise
                                    elif delete_version_num == int(doc_v):
                                        print('duplicate: passed')
                                        print(ion_to_json(ion_record))
                                    else:
                                        raise
                                else:
                                    raise
                        elif just_user_view == 'True':
                            if order == 'False':
                                history_statement = f'replace into {table_name.lower()}bonus {col.lower()} values {val}'
                                cur.execute(history_statement)
                            elif order == 'True':
                                check = f'SELECT max(docv) FROM {table_name.lower()} WHERE docid = "{doc_id}" FOR UPDATE'
                                cur.execute(check)
                                select_check = cur.fetchone()
                                print(select_check)
                                if select_check[0] == None:
                                    #delete_version_bool = False
                                    if int(doc_v) == 1:
                                        cur.execute(statement)
                                    elif int(doc_v) > 1:
                                        raise
                                    else:
                                        raise
                                elif select_check[0] != None:
                                    #delete_version_bool = True
                                    delete_version_num = int(select_check[0])
                                    if delete_version_num > -1 and delete_version_num + 1 == int(doc_v):
                                        print('insert then delete')
                                        print(ion_to_json(ion_record))
                                        cur.execute(statement)
                                    elif delete_version_num > int(doc_v):
                                        print('out of order: passed')
                                        print(ion_to_json(ion_record))
                                        raise
                                    elif delete_version_num == int(doc_v):
                                        print('duplicate: passed')
                                        print(ion_to_json(ion_record))
                                    else:
                                        raise
                                else:
                                    raise
                    conn.commit()
                except pymysql.Error as e:
                    if (e.args[0] == 1062):
                        #raise RuntimeError("raising error: " + str(e))
                        print(f"Duplicate entry for {doc_id}#{doc_v} entry with: {statement}")
                    elif (e.args[0] == 1054):
                        print(f"Unknown column in where clause for {doc_id}#{doc_v} entry with: {statement}")
                        raise
                    elif (e.args[0] == 1064):
                        print(f"You have an error in your SQL syntax for: {doc_id}#{doc_v} entry with: {statement}")
                        raise
                    else:
                        print("other error as: ",e,statement)
                        raise
        elif (("recordType" in ion_record) and (ion_record["recordType"] == BLOCK_SUMMARY_RECORD_TYPE)):
            print("Adding BLOCK_SUMMARY to log")
            print("BLOCK_SUMMARY Ion reocord: ", (ion.dumps(ion_record, binary=False)))
            
        item_count += 1
        
    return "Added %d items from RDS MySQL table" %(item_count) 


def get_data_metdata_from_revision_record(revision_record):
    """
    Retrieves the data block from revision Revision Record
    Parameters:
       topic_arn (string): The topic you want to publish to.
       message (string): The message you want to send.
    """

    revision_data = None
    revision_metadata = None

    if ("payload" in revision_record) and ("revision" in revision_record["payload"]):
        if ("data" in revision_record["payload"]["revision"]):
            revision_data = revision_record["payload"]["revision"]["data"]
        if ("metadata" in revision_record["payload"]["revision"]):
            revision_metadata = revision_record["payload"]["revision"]["metadata"]

    return [revision_data, revision_metadata]


def get_table_info_from_revision_record(revision_record):
    """
    Retrieves the table information block from revision Revision Record
    Table information contains the table name and table id
    """

    if (("payload" in revision_record) and "tableInfo" in revision_record["payload"]):
        return revision_record["payload"]["tableInfo"]

def load_schema():
    with conn.cursor() as cur:
        #cur.execute('create database v-r-Sep-14-2020-15-41-52'.replace('-','_'))
        #conn.commit
        for table in schema['LEDGER']:
            statement  = f"CREATE TABLE {table} (DocId varchar(22) NOT NULL, DocV int NOT NULL, "
            index = "INDEX ("
            for each in schema['LEDGER'][table]: statement += f"{each} {schema['LEDGER'][table][each][1]}, "
            index_list = [each for each in schema['LEDGER'][table] if schema['LEDGER'][table][each][0] == True]
            for ind in index_list: index += f"{ind}, "
            statement += index[:-2] + "), "
            statement += "PRIMARY KEY (DocId, DocV))"
            print(statement)
            cur.execute(statement)
        conn.commit()
    return None

    
def desc_db_f():
    with conn.cursor() as cur:
        cur.execute('show tables')
        for row in cur:
            logger.info(row)