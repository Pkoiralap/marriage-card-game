const handlers = require('./handlers')

const routes = [
    { method: 'GET', path: '/', handler: handlers.baseHandler},
    { method: 'POST', path: '/create', handler: handlers.createGame},
];

module.exports = routes;
