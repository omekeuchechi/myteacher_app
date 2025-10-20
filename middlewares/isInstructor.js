const isInstructor = (req, res, next) => {
    // Ensure req.decoded exists and authJs middleware has run
    if (!req.decoded) {
        return res.status(401).json({ message: "Authentication required. No token provided or token is invalid." });
    }

    const isUserInstructor = req.decoded.isInstructor;

    if (isUserInstructor) {
        // User is an instructor, proceed to the next middleware or route handler
        next();
    } else {
        // User is not an instructor
        return res.status(403).json({ message: "Forbidden. Instructor privileges required." });
    }
};

module.exports = isInstructor;