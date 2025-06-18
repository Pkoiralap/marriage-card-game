'use strict';

const Hapi = require('@hapi/hapi');
const Path = require('path');
const routes = require('./routes');
const dbHandler = require('../database');

const init = async () => {
    const server = Hapi.server({
        port: 8085,
        host: '0.0.0.0',
        routes: {
            files: {
                relativeTo: Path.join(__dirname, '../public')
            }
        }
    });

    // Initialize the database handler
    const db = new dbHandler();
    await db.initDatabase();

    // serve static files
    await server.register(require('@hapi/inert'));
    server.route({
        method: 'GET',
        path: '/{param*}',
        handler: {
            directory: {
                path: '../public',
                index: ['index.html']
            }
        }
    });

    // add imported routes
    server.route(routes.map(item => ({
        ...item,
        handler: (request, h) => item.handler(request, h, db),
    })));

    await server.start();
    console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();