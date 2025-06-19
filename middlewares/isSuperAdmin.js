const isSuperAdmin = (req, res, next) => {
    // Ensure req.decoded exists and authJs middleware has run
    if (!req.decoded) {
        return res.status(401).json({ message: "Authentication required. No token provided or token is invalid." });
    }

    const isUserSuperAdmin = req.decoded.isSuperAdmin;

    if (isUserSuperAdmin) {
        // User is a super admin, proceed to the next middleware or route handler
        next();
    } else {
        // User is not a super admin
        return res.status(403).json({ message: "Forbidden. Super admin privileges required." });
    }
};

module.exports = isSuperAdmin;