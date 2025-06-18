const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'marriage';
const config = {
    name: dbName,
    url: mongoUrl,
};

module.exports = config;
