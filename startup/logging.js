require('winston-mongodb');
const winston = require('winston');
require('express-async-errors'); // for handling uncaught async exception
const config = require('config');

module.exports = function(){
    
    //logging error in file
    winston.exceptions.handle(
        new winston.transports.Console({ colorize:true, prettyPrint: true }),
        new winston.transports.File({ filename: 'uncaughtException.log' })
    )

    // we are throwing exception on purpose so winston can catch it.
    process.on('unhandledRejection', (ex) => {
        throw ex;
    });

    winston.configure({
        transports: [
          new winston.transports.Console({ colorize:true, prettyPrint: true }),
          new winston.transports.File({ filename: 'common.log' })
        ]
      });

    // logging error in database
    let logDb;
    try {
        logDb = config.get('mongoURI');
    } catch (_) {
        logDb = config.get('host.domain');
    }

    winston.add(new winston.transports.MongoDB({
        db: logDb,
        level: 'info',
        options: { useUnifiedTopology: true }
    }));

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