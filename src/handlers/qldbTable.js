/*
Lambda function utilizada como un recurso personalizado para la creacion de la tabla "Sufragios" en QLDB usando CloudFormation
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

async function createTable(txn, tableName) {
    const statement = `CREATE TABLE ${tableName}`;
    return txn.execute(statement).then((result) => {
        logger.debug(`Tabla ${tableName} creada con exito.`);
        return result;
    });
}

const handler = async (event, context) => {
    logger.debug(`Peticion recibida para creacion de la Tabla QLDB:\n${JSON.stringify(event, null, 2)}`);

    try {
        if (event.RequestType === 'Create') {
            logger.debug('Intentando crear tabla QLDB...');
            try {
                await qldbDriver.executeLambda(async (txn) => {
                    await createTable(txn, process.env.TABLE_NAME);
                });
            } catch (e) {
                logger.error(`No es posible conectarse: ${e}`);
                await response.send(event, context, response.FAILED);
            }
            const responseData = { requestType: event.RequestType };
            await response.send(event, context, response.SUCCESS, responseData);
        } else if (event.RequestType === 'Delete') {
            logger.debug('Peticion recibida para borrar tabla QLDB');
            const responseData = { requestType: event.RequestType };
            await response.send(event, context, response.SUCCESS, responseData);
        } else {
            logger.error('No se ha reconocido el tipo de peticion');
            await response.send(event, context, response.FAILED);
        }
    } catch (error) {
        logger.error(`No se pudo crear la tabla en el recurso personalizado: ${JSON.stringify(error)}`);
        await response.send(event, context, response.FAILED);
    }
};

module.exports.handler = middy(handler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer))
    .use(logMetrics(metrics, { captureColdStartMetric: true }));