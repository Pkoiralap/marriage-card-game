const MongoClient = require('mongodb').MongoClient;
const config = require('./config');

class DatabaseHandler {
    constructor() {
        this.db = {};
    }

    async initDatabase() {
        const client = await MongoClient.connect(
            `${config.url}/${config.name}`,
            {
                useUnifiedTopology: true,
                useNewUrlParser: true
            }
        );
        this.db = client.db();
    }

    createDocument(col, doc) {
        const collection = this.db.collection(col);
        return collection.insert(doc);
    }
}

module.exports = DatabaseHandler;
