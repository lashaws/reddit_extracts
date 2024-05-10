require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const delay = ms => new Promise(res => setTimeout(res, ms));

const config = {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    userAgent: process.env.USER_AGENT,
    subreddit: 'Denver',
    accessToken: '',
    delayBetweenRequests: 1500  // in milliseconds
};

const resultsFile = path.join(__dirname, 'firstrun.json');
let existingData = [];

if (fs.existsSync(resultsFile)) {
    let fileContents = fs.readFileSync(resultsFile, 'utf8');
    // Attempt to repair broken JSON if necessary by ensuring it wraps in an array
    if (!fileContents.startsWith('[')) {
        fileContents = '[' + fileContents;
    }
    if (!fileContents.endsWith(']')) {
        fileContents = fileContents + ']';
    }
    try {
        existingData = JSON.parse(fileContents);
    } catch (error) {
        console.error('Error reading existing data:', error);
        existingData = [];
    }
}

async function authenticate() {
    try {
        const response = await axios.post('https://www.reddit.com/api/v1/access_token', 'grant_type=client_credentials', {
            headers: { 'User-Agent': config.userAgent },
            auth: { username: config.clientId, password: config.clientSecret }
        });
        config.accessToken = response.data.access_token;
    } catch (error) {
        console.error('Authentication failed:', error);
    }
}

async function fetchFromAPI(url) {
    await delay(config.delayBetweenRequests);
    return axios.get(url, {
        headers: { 'Authorization': `Bearer ${config.accessToken}`, 'User-Agent': config.userAgent }
    });
}

async function getSubredditPosts(listing, after = '') {
    const yearThreshold = 2018;
    const posts = [];
    let currentAfter = after;
    let hasMore = true;

    while (hasMore) {
        const url = `https://oauth.reddit.com/r/${config.subreddit}/${listing}?limit=100&after=${currentAfter}`;
        const res = await fetchFromAPI(url);
        for (const child of res.data.data.children) {
            const postDate = new Date(child.data.created_utc * 1000).getFullYear();
            if (postDate >= yearThreshold && !existingData.some(e => e.id === child.data.id)) {
                posts.push(child.data);
            }
        }
        currentAfter = res.data.data.after;
        hasMore = currentAfter !== null && new Date(res.data.data.children[res.data.data.children.length - 1].data.created_utc * 1000).getFullYear() >= yearThreshold;
    }
    return posts;
}

async function getComments(postId) {
    try {
        const url = `https://oauth.reddit.com/comments/${postId}?limit=100`;
        const res = await fetchFromAPI(url);
        return res.data[1].data.children.map(child => child.data.body);
    } catch (error) {
        console.error('Failed to fetch comments for post:', postId, error);
        return [];
    }
}

async function run() {
    try {
        await authenticate();
        const listings = ['new', 'hot', 'top', 'rising', 'controversial'];
        const results = [];

        for (let listing of listings) {
            console.log(`Fetching posts from ${listing} listing...`);
            const posts = await getSubredditPosts(listing);
            for (let post of posts) {
                const comments = await getComments(post.id);
                results.push({
                    title: post.title,
                    id: post.id,
                    listing: listing,
                    comments: comments
                });
            }
        }

        const combinedResults = existingData.concat(results);
        fs.writeFileSync(resultsFile, JSON.stringify(combinedResults, null, 2));
        console.log('Data appended to firstrun.json');
    } catch (error) {
        console.error('Error in run function:', error);
    }
}

run();
