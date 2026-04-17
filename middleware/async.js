// this is useful for catching error in route blocks, however there is a alternative available as well.
// this or express-async-error
module.exports = function(handler){
  return async(request, response, next) =>{
        try{
            await handler(request, response);
        }catch(err){
            next(err);
        }
    };
}