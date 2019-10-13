const fs = require('fs');
const path = require('path');

const Game = require('../classes/game');
const Player = require('../classes/player');
const gameList = {};

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
        // playerName
        const {payload} = request;

        const player = new Player(payload.playerName)
        const game = new Game(db);

        gameList[game.id] = game;
        game.addPlayer(player);
        try {
            await game.save();
        } catch (err) {
            console.log(err);
        }

        return h.response({
            success: true,
            data: {
                gameId: game.id,
            },
            message: ''
        }).type('application/json');
    },
    joinGame: async (request, h) => {
        // gameId, playerName
        const {payload} = request;

        const player = new Player(payload.playerName)
        const game = gameList[payload.gameId];
        if (!game) {
            return {
                success: false,
                message: 'No game with that id exists',
            };
        }
        const {success, data, message} = game.addPlayer(player);
        await game.save();
        return h.response({
            success,    
            data,
            message,
        }).type('application/json');
    },
    startGame: async (request, h, db) => {
        // gameId, playerName
        const {payload} = request;
        const game = gameList[payload.gameId];
        if (!game) {
            return {
                success: false,
                message: 'No game with that id exists',
            };
        }
        if (game.players.length <= 1) {
            return {
                success: false,
                message: 'Atleast two players are required',
            };
        }
        
        // start the game
        game.initiate();
        return h.response({
            success: true,    
            message: 'Game initiated',
        }).type('application/json');
    },
};

module.exports = handlers;
