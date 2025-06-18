const mongoUrl = process.env.MONGODB_URL;
const dbName = process.env.DB_NAME;
const config = {
    name: dbName,
    url: mongoUrl,
};

module.exports = config;
