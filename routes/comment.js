const express = require('express');
const router = express.Router();
const Comment = require('../models/comment');
const authJs = require('../middlewares/auth');
const { cacheMiddleware, invalidateCache, invalidateCacheByKey } = require('../middlewares/cache');
const Post = require('../models/post');

router.post('/:postId/postComment', authJs, async (req, res) =>{
    const postId = req.params.postId;
    const userId = req.decoded.userId;

    const postComment = new Comment({
        content: req.body.content,
        createdBy: userId,
        post: postId
    })

    try {
        const post = await Post.findById(postId);

        if (!post) {
            return res.status(404).json({
                message: "post not found"
            });
        }

        post.comments.push(postComment._id);


        const createdComment = await postComment.save();
        const updatedPost = await post.save();
        
        // Invalidate cache after successful comment creation
        await invalidateCache('comments');

        res.status(200).json({
            message: "successfully added post comment",
            postComment: createdComment
        });


    } catch (error) {
        res.status(500).json({
            message: "internal server error",
            error: error
        })
    }
});


router.post('/commentId/createComment', authJs, async (req, res) => {
    const commentId = req.params.commentId;
    const userId = req.decoded.userId;

    const reply = new Comment({
        content: req.body.content,
        createdBy: userId,
        parentComment: commentId
    });

    try {
        const parentComment = await Comment.findById(commentId);
        if (!parentComment) {
            return res.status(404).json({
                message: "parent comment not found"
            });
        }
        
        parentComment.replies.push(reply._id);
        await parentComment.save();
        await reply.save();
        
        // Invalidate cache after successful reply creation
        await invalidateCache('comments');
        
        res.status(200).json({
            message: "successfully added reply",
            reply: reply
        });
    } catch (error) {
        res.status(500).json({
            message: "internal server error",
            error: error
        })
    }
})

router.get('/comments', cacheMiddleware(300), async (req, res) => {
    try {
        const comments = await Comment.find().populate('post', ['title', 'content', 'createdAt', 'createdBy']).populate('replies', ['content', 'createdAt', 'createdBy']);
        res.status(200).json(comments);
    } catch (error) {
        res.status(500).json({
            message: "internal server error",
            error: error
        })
    }
})

module.exports = router;