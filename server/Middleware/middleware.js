const User=require('../Models/user');
const jwt=require('jsonwebtoken');
const user=require('../Models/user')
const key=process.env.JWT_SECRET

async function requireAuth(req, res, next) {
    const token = req.cookies?.rhythm_token;
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
        req.jwtPayload = jwt.verify(token, process.env.JWT_SECRET);
        req.user=await user.findOne({account_id:req.jwtPayload.account_id});
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
}

module.exports=requireAuth;