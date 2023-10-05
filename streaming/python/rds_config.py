# config file containing credentials for RDS MySQL instance
db_username = "username"
db_password = "password"
db_name = "ledger_test"
schema = {
    "LEDGER": {
        "sufragios": {
            "sufragioId": [True, "VARCHAR(32)"],
            "nombre": [True, "VARCHAR(100)"],
            "dui": [True, "VARCHAR(10)"],
            "centroVotacion": [False, "int"],
            "departamento": [False, "int"],
            "municipio": [False, "int"],
            "sexo": [False, "ENUM('M','F')"],
            "userId": [False, "int"],
            "estado": [False, "ENUM('0','1','2')"],
            "eventname": [
                False,
                "ENUM('ingresoCentroVotacion','verificacionMesaReceptora','ejecutandoSufragio')",
            ],
            "status": [False, "ENUM('0','1','2')"],
            "votoId": [False, "int"],
            "fecha": [False, "DATETIME"],
            "events": [False, "TEXT"],
        },
    }
}
