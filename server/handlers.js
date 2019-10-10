var fs = require('fs');
const path = require('path');
const UUID = require('uuid');

const publicPath = path.resolve(__dirname, '../public/index.html');
const handlers = {
    baseHandler: (request, h) => {
        try {
            const data = fs.readFileSync(publicPath, 'utf8');
            return h.response(data).type('text/html');
        } catch(err) {
            console.log(err)
        }
    },
    createGame: async (request, h, db) => {
        const {payload} = request;
        const gameId = UUID.v4();

        // create game in database
        await db.createDocument('testCol', {a: 1});
        return h.response({
            success: true,
            data: {
                gameId,
            },
            message: ''
        }).type('application/json');
    },
};

module.exports = handlers;
