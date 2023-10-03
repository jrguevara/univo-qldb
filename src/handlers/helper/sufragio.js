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
async function addSufragioId(txn, docId, dui) {
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
            await addSufragioId(txn, docId, dui);
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

/**
 * Funcion de ayuda para obtener la ultima revision del documento por el id del documento
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param sufragioId El id del documento del que se recuperara la informacion
 * @returns El resultado de la ejecucion del query
 */
async function getSufragioRecordById(txn, sufragioId) {
    console.log('En funcion getSufragioRecordById');
    const query = 'SELECT * FROM Sufragios AS b WHERE b.sufragioId = ?'
    return txn.execute(query, sufragioId);
}

/**
 * Funcion de ayuda para actualizar el Sufragio
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param sufragioId El id del documento a actualizar
 * @param newEstado El nuevo estado del sufragio
 * @param eventInfo El evento a agregar al documento
 * @returns El resultado de la ejecucion del query
 */
async function updateSufragio(txn, sufragioId, newEstado, eventInfo) {
    console.log(`En la actualizacion de estado de sufragioId ${sufragioId} y evento ${eventInfo}`);
    const statement = 'UPDATE Sufragios SET estado = ?, events = ? WHERE sufragioId = ?';
    return txn.execute(statement, newEstado, eventInfo, sufragioId);
}

/**
 * Verifica el sufragio en mesa receptora cambiando estado/status a 1
 * @param dui EL dui con el que se buscara el sufragio
 * @param event El evento a agregar al documento
 * @returns Documento JSON para devolver al cliente
 */
const verificarSufragio = async (sufragioId, eventInfo) => {
    console.log(`En la funcion de ejecucion de sufragio ${sufragioId}, y eventInfo ${eventInfo}`);

    let sufragio;
    // Obtienes una instancia del driver de QLDB
    const qldbDriver = await getQldbDriver();
    await qldbDriver.executeLambda(async (txn) => {
        //Se obtiene el registro actual del sufragio
        const result = await getSufragioRecordById(txn, sufragioId);
        const resultList = result.getResultList();

        if (resultList.length === 0) {
            throw new sufragioError(400, 'Error de integridad de sufragio', `Registro de sufragio con el sufragioId ${sufragioId} no existe`);
        } else {
            const newEstado = 1;
            await updateSufragio(txn, sufragioId, newEstado, eventInfo);
            sufragio = {
                sufragioId,
                estado: newEstado,
            };
        }
    });
    return sufragio;
};

/**
 * Ejecucion del sufragio en cabina de votacion cambiando estado/status a 2
 * @param dui EL dui con el que se buscara el sufragio
 * @param event El evento a agregar al documento
 * @returns Documento JSON para devolver al cliente
 */
const ejecutarSufragio = async (sufragioId, eventInfo) => {
    console.log(`En la funcion de ejecutar el sufragio ${sufragioId}, y eventInfo ${eventInfo}`);

    let sufragio;
    // Obtienes una instancia del driver de QLDB
    const qldbDriver = await getQldbDriver();
    await qldbDriver.executeLambda(async (txn) => {
        //Se obtiene el registro actual del sufragio
        const result = await getSufragioRecordById(txn, sufragioId);
        const resultList = result.getResultList();

        if (resultList.length === 0) {
            throw new sufragioError(400, 'Error de integridad de sufragio', `Registro de sufragio con el sufragioId ${sufragioId} no existe`);
        } else {
            const newEstado = 2;
            await updateSufragio(txn, sufragioId, newEstado, eventInfo);
            sufragio = {
                sufragioId,
                estado: newEstado,
            };
        }
    });
    return sufragio;
};

/**
 * Funcion de ayuda para obtener la ultima revision del documento por el id del documento
 * @param txn El {@linkcode TransactionExecutor} para la ejecucion del lambda
 * @param sufragioId El id del documento del que se recuperara la informacion
 * @returns El resultado de la ejecucion del query
 */
async function getHistorialSufragioById(txn, sufragioId) {
    console.log('En la funcion getHistorialSufragioById');
    const query = 'SELECT * FROM history(Sufragios) WHERE metadata.id = ?';
    return txn.execute(query, sufragioId);
}

/**
 * Funcion de ayuda para recuperar el estado actual e historico de un registro de sufragio
 * @param sufragioId El id del documento del que se recuperara la informacion
 * @returns Documento JSON para devolver al cliente
 */
const historialSufragio = async (sufragioId) => {
    console.log(`En funcion historialSufragio con sufragioId ${sufragioId}`);

    let historial;
    // Obtienes una instancia del driver de QLDB
    const qldbDriver = await getQldbDriver();
    await qldbDriver.executeLambda(async (txn) => {
        //Se obtiene el registro actual del sufragio
        const result = await getHistorialSufragioById(txn, sufragioId);
        const historialArray = result.getResultList();
        if (historialArray.length === 0) {
            throw new sufragioError(400, 'Error de integridad de sufragio', `Registro de sufragio con el sufragioId ${sufragioId} no existe`);
        } else {
            historial = JSON.stringify(historialArray);
        }
    });
    return historial;
};


module.exports = {
    crearSufragio,
    verificarSufragio,
    ejecutarSufragio,
    historialSufragio,
};