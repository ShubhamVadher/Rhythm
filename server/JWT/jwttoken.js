const jwt = require('jsonwebtoken');
const key = process.env.JWT_SECRET;

const createToken = (user) => {
    const token = jwt.sign({ account_id: user.account_id, name: user.name }, key);
    return token;
}

module.exports = createToken;
