'use strict';

const Path = require('path');
const Hapi = require('@hapi/hapi');
const routes = require('./routes');
const dbHandler = require('../database');

const publicPath = process.env.PUBLIC_PATH || Path.resolve(__dirname, '../public');

console.log('Public path:', publicPath);
const init = async () => {
    const server = Hapi.server({
        port: 8085,
        host: 'localhost',
        routes: {
            files: {
                relativeTo: publicPath
            }
        }
    });
    const db = new dbHandler();
    await db.initDatabase();
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