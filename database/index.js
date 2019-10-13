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

    deleteDocument(col, filter) {
        const collection = this.db.collection(col);
        return collection.deleteOne(filter);
    }

    getDocument(col, doc) {
        const collection = this.db.collection(col);
        return collection.findOne({_id: doc.id});
    }

    async existsDocument(col, doc) {
        const fetchedDoc = await this.getDocument(col, doc);
        console.log(fetchedDoc);
        return !!fetchedDoc;
    }

    createDocument(col, doc) {
        const collection = this.db.collection(col);
        return collection.insert(doc);
    }

    replaceDocument(col, filter, doc) {
        const collection = this.db.collection(col);
        return collection.replaceOne(filter, doc);
    }
}

module.exports = DatabaseHandler;
