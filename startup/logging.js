require('winston-mongodb');
const winston = require('winston');
const config = require('config');
let initialized = false;

module.exports = function(){
    if (initialized) return;
    initialized = true;
    
    //logging error in file
    winston.exceptions.handle(
        new winston.transports.Console({ colorize:true, prettyPrint: true }),
        new winston.transports.File({ filename: 'uncaughtException.log' })
    )

    // we are throwing exception on purpose so winston can catch it.
    if (!process.listeners('unhandledRejection').some(listener => listener.cineVaultHandler)) {
        const rejectionHandler = (ex) => { throw ex; };
        rejectionHandler.cineVaultHandler = true;
        process.on('unhandledRejection', rejectionHandler);
    }

    winston.configure({
        transports: [
          new winston.transports.Console({ colorize:true, prettyPrint: true }),
          new winston.transports.File({ filename: 'common.log' })
        ]
      });

    // logging error in database
    if (process.env.NODE_ENV !== 'test') {
        let logDb;
        try {
            logDb = config.get('mongoURI');
        } catch (_) {
            logDb = config.get('host.domain');
        }

        winston.add(new winston.transports.MongoDB({
            db: logDb,
            level: 'info'
        }));
    }

    // common error
    // winston.add( 
    //     new winston.transports.Console({ colorize:true, prettyPrint: true }),
    //     new winston.transports.File({ filename: 'combined.log' })
    // )
}

//winston('error', err.message);
// loggin level, determines the importance of the message we are going to log.
// error
// warning
// info
// verbose
// debug
// silly
