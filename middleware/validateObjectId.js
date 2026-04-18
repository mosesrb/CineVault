 
 const mongoose = require('mongoose');
 module.exports = function( request, response, next){
     // check if ID is valid
    if(!mongoose.Types.ObjectId.isValid(request.params.id))
        return response.status(404).send('Invalid ID');

    // pass the control to next middleware function
    next();
}