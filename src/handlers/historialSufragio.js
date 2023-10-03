/*
Funcion lambda que implementa la funcionalidad de obtener historial
 */
const { Logger, injectLambdaContext } = require('@aws-lambda-powertools/logger');
const { Tracer, captureLambdaHandler } = require('@aws-lambda-powertools/tracer');
const { Metrics, MetricUnits, logMetrics } = require('@aws-lambda-powertools/metrics');
const middy = require('@middy/core')
const { historialSufragio } = require('./helper/sufragio');
const sufragioError = require('./lib/sufragioError');
const cors = require('@middy/http-cors')

const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

tracer.captureAWS(require('aws-sdk'));

const handler = async (event) => {
    const { sufragioId } = event.pathParameters;
    logger.debug(`En la funcion de historial de sufragioId ${sufragioId}`);

    try {
        const response = await historialSufragio(sufragioId);
        metrics.addMetric('historialSufragioExitoso', MetricUnits.Count, 1);
        const historial = JSON.parse(response);
        return {
            statusCode: 200,
            body: JSON.stringify(historial),
        };
    } catch (error) {
        if (error instanceof sufragioError) {
            return error.getHttpResponse();
        }
        metrics.addMetric('historialSufragioFallido', MetricUnits.Count, 1);
        logger.error(`Error retornado: ${error}`);
        const errorBody = {
            status: 500,
            title: error.name,
            detail: error.message,
        };
        return {
            statusCode: 500,
            body: JSON.stringify(errorBody),
        };
    }
};

module.exports.handler = middy(handler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer))
    .use(logMetrics(metrics, { captureColdStartMetric: true }))
    .use(cors());