/*
Funcion lambda que implementa la funcionalidad de verificar sufragio en mesa receptora
*/
const { Logger, injectLambdaContext } = require('@aws-lambda-powertools/logger');
const { Tracer, captureLambdaHandler } = require('@aws-lambda-powertools/tracer');
const { Metrics, MetricUnits, logMetrics } = require('@aws-lambda-powertools/metrics');
const middy = require('@middy/core');
const date = require('date-and-time');
const { ejecutarSufragio } = require('./helper/sufragio');
const sufragioError = require('./lib/sufragioError');
const cors = require('@middy/http-cors');

const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

tracer.captureAWS(require('aws-sdk'));

const handler = async (event) => {
    const { sufragioId, votoId } = JSON.parse(event.body);
    //const userId = 2;
    logger.debug(`En el proceso de ejecucion de sufragioId ${sufragioId}`);
    let eventInfo;
    try {
        eventInfo = { eventName: 'ejecutandoSufragio', status: 2, votoId: votoId, eventDate: date.format(new Date(), 'YYYY/MM/DD HH:mm:ss') };
        const response = await ejecutarSufragio(sufragioId, eventInfo, votoId);
        metrics.addMetric('ejecutarSufragioExitoso', MetricUnits.Count, 1);
        return {
            statusCode: 200,
            body: JSON.stringify(response),
        };
    } catch (error) {
        if (error instanceof sufragioError) {
            return error.getHttpResponse();
        }
        metrics.addMetric('ejecutarSufragioFallido', MetricUnits.Count, 1);
        logger.error(`Error regresado: ${error}`);
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