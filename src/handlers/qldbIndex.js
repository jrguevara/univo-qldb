/*
Lambda function utilizada como un recurso personalizado para la creacion de indexs en la tabla "Sufragios" en QLDB usando CloudFormation
 */

const { Logger, injectLambdaContext } = require('@aws-lambda-powertools/logger');
const { Tracer, captureLambdaHandler } = require('@aws-lambda-powertools/tracer');
const { Metrics, MetricUnits, logMetrics } = require('@aws-lambda-powertools/metrics');
const middy = require('@middy/core');
const response = require('cfn-response-promise');
const { QldbDriver } = require('amazon-qldb-driver-nodejs');
const qldbDriver = new QldbDriver(process.env.LEDGER_NAME);

const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

tracer.captureAWS(require('aws-sdk'));

async function createIndex(txn, tableName, indexAttribute) {
    const statement = `CREATE INDEX on ${tableName} (${indexAttribute})`;
    return txn.execute(statement).then((result) => {
        logger.debug(`Index ${indexAttribute} creado exitosamente en tabla ${tableName}.`);
        return result;
    });
}

const handler = async (event, context) => {
    try {
        if (event.RequestType === 'Create') {
            logger.debug(`Peticion recibida para creacion de QLDB Index:\n${JSON.stringify(event, null, 2)}`);
            try {
                await qldbDriver.executeLambda(async (txn) => {
                    Promise.all([
                        createIndex(txn, process.env.TABLE_NAME, process.env.INDEX_NAME_1),
                        createIndex(txn, process.env.TABLE_NAME, process.env.INDEX_NAME_2),
                    ]);
                });
            } catch (e) {
                logger.error(`No es posible conectarse: ${e}`);
                await response.send(event, context, response.FAILED);
            }
            const responseData = { requestType: event.RequestType };
            await response.send(event, context, response.SUCCESS, responseData);
        } else if (event.RequestType === 'Delete') {
            logger.debug('Peticion recibida para borrar index QLDB');
            const responseData = { requestType: event.RequestType };
            await response.send(event, context, response.SUCCESS, responseData);
        } else {
            logger.error('No se ha reconocido el tipo de peticion');
            await response.send(event, context, response.FAILED);
        }
    } catch (error) {
        logger.error(`Listado de errores: ${error}`);
        await response.send(event, context, response.FAILED, { Error: error });
    }
};

module.exports.handler = middy(handler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer))
    .use(logMetrics(metrics, { captureColdStartMetric: true }));