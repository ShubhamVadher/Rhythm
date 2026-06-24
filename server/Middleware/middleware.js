const User=require('../Models/user');
const jwt=require('jsonwebtoken');

const key=process.env.JWT_SECRET

function requireAuth(req, res, next) {
    const token = req.cookies?.rhythm_token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
        req.jwtPayload = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
}

module.exports=requireAuth;