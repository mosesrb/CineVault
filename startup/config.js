const config = require('config');

// Initialize at the start to make sure variable is set, otherwise auth endpoint won't work.
module.exports = function(){
    if(!config.get('jwtPrivateKey')){
        // throw error cause our current settings will catch it.
        throw new Error("Fatal Error jwtPrivateKey is not defined");
    }
}
 