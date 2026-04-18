
module.exports = function( request, response, next){
    // 401 Unauthorized, 403 Forbidden

    // since we already set request.user with header in previous middleweare, it is available for use here.
    if(!request.user.isAdmin) return response.status(403).send('Forbidden');
    
    // pass the control
    next(); 
}