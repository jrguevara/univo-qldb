/* Funcion lambda que implementa la funcionalidad de crear sufragio
 */
const { Logger, injectLambdaContext } = require('@aws-lambda-powertools/logger');
const { Tracer, captureLambdaHandler } = require('@aws-lambda-powertools/tracer');
const { Metrics, MetricUnits, logMetrics } = require('@aws-lambda-powertools/metrics');
const middy = require('@middy/core');
const date = require('date-and-time');
const { crearSufragio } = require('./helper/sufragio');
const sufragioError = require('./lib/sufragioError');
const cors = require('@middy/http-cors')

// Parametros obtenidos de las variables de entorno
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

tracer.captureAWS(require('aws-sdk'));

const handler = async (event) => {
    const {
        nombre, dui, centroVotacion, departamento, municipio, sexo,
    } = JSON.parse(event.body);
    const userId = 1;
    logger.debug(`Creacion de sufragio con los datos: Nombre: ${nombre}, DUI: ${dui}, Centro de votacion: ${centroVotacion}, Departamento: ${departamento}, Municipio: ${municipio}, Sexo: ${sexo} y userId ${userId}`);

    try {
        const eventInfo = { eventName: 'ingresoCentroVotacion', eventDate: date.format(new Date(), 'YYYY/MM/DD HH:mm:ss') };
        const response = await crearSufragio(
            logger, nombre, dui, centroVotacion, departamento, municipio, sexo, userId, eventInfo
        );
        metrics.addMetric('creacionSufragioExitoso', MetricUnits.Count, 1);
        return {
            statusCode: 201,
            body: JSON.stringify(response),
        };
    } catch (error) {
        if (error instanceof sufragioError) {
            return error.getHttpResponse();
        }
        metrics.addMetric('creacionSufragioFallido', MetricUnits.Count, 1);
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