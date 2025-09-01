const jwt = require('jsonwebtoken');

const authJs = (req, res, next) => {
    try {
        // Get token from header or query parameter
        let token = req.header('authorization') || req.header('Authorization') || req.query.token;
        
        if (!token) {
            console.error('No authentication token found');
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.',
                error: 'Missing authentication token'
            });
        }

        // Remove 'Bearer ' if present
        if (token.startsWith('Bearer ')) {
            token = token.substring(7);
        }

        if (!process.env.TOKEN_SECRET_WORD) {
            console.error('JWT secret not configured');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error',
                error: 'JWT secret not configured'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);
        
        if (!decoded) {
            console.error('Failed to decode token');
            return res.status(401).json({
                success: false,
                message: 'Invalid token',
                error: 'Failed to decode authentication token'
            });
        }

        // Standardize the user object with fallbacks
        const user = {
            id: decoded.id || decoded._id || decoded.userId,
            email: decoded.email || decoded.user?.email,
            name: decoded.name || decoded.user?.name,
            isAdmin: decoded.isAdmin || decoded.user?.isAdmin || false,
            // Include all other decoded fields
            ...(typeof decoded.user === 'object' ? decoded.user : {}),
            ...decoded
        };
        
        // Remove any potential circular references
        delete user.user;

        if (!user.id) {
            console.error('No user ID found in token');
            return res.status(401).json({
                success: false,
                message: 'Invalid token',
                error: 'No user ID found in token'
            });
        }

        // Attach user to request
        req.user = user;
        req.decoded = decoded; // For backward compatibility
        
        console.log('Authenticated user:', { id: user.id, email: user.email });
        next();
    } catch (error) {
        console.error('Authentication error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Session expired or invalid token try to Login again',
                error: 'Your session has    expired. Please log in again.'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token',
                error: 'Malformed authentication token'
            });
        }
        
        // For any other errors
        return res.status(401).json({
            success: false,
            message: 'Authentication failed',
            error: error.message
        });
    }
};

module.exports = authJs;