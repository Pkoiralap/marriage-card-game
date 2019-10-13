const handlers = require('./handlers')

const routes = [
    { method: 'GET', path: '/', handler: handlers.baseHandler},
    { method: 'POST', path: '/create', handler: handlers.createGame},
    { method: 'POST', path: '/join', handler: handlers.joinGame},
    { method: 'POST', path: '/start', handler: handlers.startGame },
    { method: 'POST', path: '/take', handler: handlers.createGame},
    { method: 'POST', path: '/throw', handler: handlers.createGame},
    { method: 'POST', path: '/findSequence', handler: handlers.createGame},
    { method: 'POST', path: '/verifySequence', handler: handlers.createGame},
    { method: 'POST', path: '/claimGame', handler: handlers.createGame},
];

module.exports = routes;
