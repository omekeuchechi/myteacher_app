const express = require('express');
const router = express.Router();
const authJs = require('../middlewares/auth');
const Post = require('../models/post');
const User = require('../models/user');

router.post('/create', authJs, async (req, res) => {

    const user = req.decoded;

    if(!user.isAdmin){
       return res.status(401).send("Not an admin, can't create post");
    }

    const post = new Post({
        category: req.body.category,
        content: req.body.content,
        createdby: user.userId
    })

    try{
        const createdPost = await post.save();
        res.status(200).json({
            message: "Post created successfully",
            post: createdPost
        })
    }catch(error){
        return res.status(500).json({
            message: "Error creating post",
            error: error
        })
    }
});

router.get('/', authJs, async(req, res) => {
    
    const posts = await Post.find();

    if(!posts.length > 0){
        return res.status(401).send("posts not found");
    }

    res.status(200).json({message: "Found posts", posts: posts});
});

router.get('/:postId', authJs, async (req, res) => {

    const postId = req.params.postId;

    try{
        const post = await Post.findById(postId);

        if(!post){
            return res.status(404).send("Post not found");
        }

        res.status(200).json({
            message: "Found the post",
            post: post
        })
    }catch(error){
        return res.status(500).json({message: "Error ocurred", error: error})
    }
});

router.patch('/:postId/like', authJs, async (req, res) => {
    const userId = req.decoded.userId;
    const postId = req.params.postId;

    const post = await Post.findById(postId);
    const user = await User.findById(userId);

    if(!post && !user){
        return res.status(404).send("post or user not found");
    }

    if(post.likedBy.includes(userId) || user.postsLiked.includes(postId)){
        return res.status(400).send("You already liked this post");
    }

    post.likedBy.push(userId);
    user.postsLiked.push(postId);

    const updatedPost = await post.save();
    const updatedUser = await user.save();

    if(updatedPost && updatedUser){
        res.status(200).json({message: "Posts liked successfully", post: updatedPost, user: updatedUser});
    }else {
        res.status(400).send("Post and user data not updated");
    }
});


router.patch('/:postId/unlike', authJs, async (req, res) => {
    const postId = req.params.postId;
    const userId = req.decoded.userId;

    const post = await Post.findById(postId);
    const user = await User.findById(userId);

    if(!post &&!user){
        return res.status(404).send("Post or user not found");
    }

    if(!post.likedBy.includes(userId) ||!user.postsLiked.includes(postId)){
        const indexOfUserId = post.likedBy.indexOf(userId);
        const indexOfPostId = user.postsLiked.indexOf(postId);

        post.likedBy.splice(indexOfUserId, 1);
        user.postsLiked.splice(indexOfPostId, 1);

        const updatedPost = await post.save();
        const updatedUser = await user.save();

        res.status(200).json({
            message: "successfully unliked post",
            post: updatedPost,
            user: updatedUser
        })

        // return res.status(400).send("You haven't liked this post");
    } else{

        res.status(404).send("You haven't liked this post");

    }
});


router.patch('/:postid/editPost', authJs, async (req, res) => {
    const postId = req.params.commentId;
    const userId = req.decoded.isAdmin;
    const postEditInfo = req.body;
    
    if(!userId){
        return res.status(401).send("Unauthorized, you are not an admin");
    }

    const post = await Post.findById(postId);

    if(!post){
        return res.status(404).send("Post not found");
    }

    for(prop in postEditInfo){
        switch (prop) {
            case "category":
                post.prop = postEditInfo.prop;
                break;
            case "content":
                post.prop = postEditInfo.prop;
                break;
            default:
                return;
        }
    }

    try {
        const editedPost = await post.save();
        res.status(200).json({message: "Post edited successfully", post: editedPost});
    } catch (error) {
        res.status(500).json({
            message: "Error editing post",
            error: error
        });
    }
});

router.delete('/:postId/deletePost', authJs, async (req, res) => {
    const postId = req.params.postId;
    const userId = req.decoded.isAdmin;

    if(!userId){
        return res.status(401).send("Unauthorized, you are not an admin");
    }

    try{
        const deletedPost = await Post.findByIdAndDelete(postId);
        
        if(!deletedPost){
            return res.status(404).send("Post does not exist");
        }
        
        res.status(200).json({message: "Post deleted successfully", deletedPost: deletedPost});
    } catch (error) {
        res.status(500).json({
            message: "Error deleting post",
            error: error
        });
    }
});


module.exports = router;
