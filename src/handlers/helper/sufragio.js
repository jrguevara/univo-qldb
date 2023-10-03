/*
Utilidad de ayuda que proporciona la implementación para interactuar con QLDB
 */

//const Log = require('@dazn/lambda-powertools-logger');
const { getQldbDriver } = require('./ConnectToLedger');
const AWSXRay = require('aws-xray-sdk-core');
AWSXRay.captureAWS(require('aws-sdk'));
const sufragioError = require('../lib/sufragioError');
const sufragioNotFoundError = require('../lib/sufragioNotFoundError');

/**
 * Verifica si ya existe un registro con el mismo dui
 * @param logger Instancia del logger
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param dui El dui a verificar
 * @returns El numero de registros que existen para el dui
 */
async function checkDuiUnique(logger, txn, dui) {
    logger.debug('Funcion checkDuiUnique:');
    const query = 'SELECT dui FROM Sufragios AS b WHERE b.dui = ?';
    let recordsReturned;
    await txn.execute(query, dui).then((result) => {
        recordsReturned = result.getResultList().length;
        if (recordsReturned === 0) {
            logger.debug(`No existen registros para el DUI ${dui}`);
        } else {
            logger.debug(`Ya existe un registro para el DUI: ${dui}`);
        }
    });
    return recordsReturned;
}

/**
 * Inserta el nuevo documento de licencia en la tabla sufragios
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param sufragioDoc Documento que contiene los detalles a insertar
 * @returns Resultado de la ejecucion del query
 */
async function crearSufragioDoc(txn, sufragioDoc) {
    const statement = 'INSERT INTO Sufragios ?';
    return txn.execute(statement, sufragioDoc);
}

/**
 * Inserta el nuevo documento de licencia en la tabla sufragios
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param docId ID del documento
 * @param sufragioId El sufragioId que se ingresara en el documento
 * @param dui dui del votante.
 * @returns Resultado de la ejecucion del query
 */
async function addGuid(txn, docId, dui) {
    const statement = 'UPDATE Sufragios as b SET b.sufragioId = ? WHERE b.dui = ?';
    return txn.execute(statement, docId, dui);
}

/**
 * Crea un nuevo registro de sufragio en el libro mayor QLDB.
 * @param logger El objeto logger pasado.
 * @param event El evento que se agregara al documento
 * @returns Retorna el registro JSON del sufragio.
 */
const crearSufragio = async (logger, nombre, dui, centroVotacion, departamento, municipio, sexo, userId, event) => {
    logger.debug(`Funcion crearSufragio: Nombre: ${nombre}, DUI: ${dui}, Centro de Votacion: ${centroVotacion}, Departamento: ${departamento}, Municipio: ${municipio} y Sexo: ${sexo}`);

    let sufragio;
    // Obtienes una instancia del driver de QLDB
    const qldbDriver = await getQldbDriver();
    await qldbDriver.executeLambda(async (txn) => {
        // Verifica si el registro ya existe asumiendo que el dui es unico
        const recordsReturned = await checkDuiUnique(logger, txn, dui);
        if (recordsReturned === 0) {
            const sufragioDoc = {
                nombre, dui, centroVotacion, departamento, municipio, sexo, estado: 0, userId, events: event,
            };
            // Crea el registro. Esto devuelve el ID del documento unico en un array como el conjunto de resultados
            const result = await crearSufragioDoc(txn, sufragioDoc);
            const docIdArray = result.getResultList();
            const docId = docIdArray[0].get('documentId').stringValue();
            // Actualiza el registro para agregar el ID del documento como el GUID en el payload
            await addGuid(txn, docId, dui);
            sufragio = {
                sufragioId: docId,
                nombre,
                dui,
                centroVotacion,
                departamento,
                municipio,
                sexo,
                estado: 0
            };
        } else {
            throw new sufragioError(400, 'Error de Integridad de Sufragio', `Ya existe un registro con el ${dui}. No agregaran mas registros`);
        }
    });
    return sufragio;
};

module.exports = {
    crearSufragio,
};