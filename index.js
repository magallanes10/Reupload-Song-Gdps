const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const cheerio = require('cheerio');

const app = express();
ffmpeg.setFfmpegPath(ffmpegPath);
const libraryPath = path.join(__dirname, 'library.json');

const savelink = {
    finalUrl: null,
    async saveAndTransfer(finalUrl) {
        this.finalUrl = finalUrl;
        const transferResponse = await axios.get(`https://fgdpscc.ps.fhgdps.com/jonell.php?url=${this.finalUrl}`, {
            headers: { 'User-Agent': 'Mozilla/5.1' },
        });
        this.clear();
        return transferResponse.data;
    },
    clear() {
        this.finalUrl = null;
    },
};

async function downloadAndUploadMusic(youtubeUrl) {
    const response = await axios.get(`https://yt-video-production.up.railway.app/ytdl?url=${youtubeUrl}`);
    const { audio: downloadLink, title } = response.data;
    const audioStream = await axios({ method: 'get', url: downloadLink, responseType: 'stream' }).then(res => res.data);
    const titleSanitized = title.replace(/[^a-zA-Z0-9]/g, '_');
    const inputFilePath = path.resolve(__dirname, `geometrydashcontentmusicreupload.mp3`);
    const outputFilePath = path.resolve(__dirname, `gdpsconverted.m4a`);
    const audioFile = fs.createWriteStream(inputFilePath);
    audioStream.pipe(audioFile);
    await new Promise((resolve, reject) => {
        audioFile.on('finish', resolve);
        audioFile.on('error', reject);
    });
    await convertMp3ToM4a(inputFilePath, outputFilePath);
    const instance = axios.create({ headers: { 'User-Agent': 'Mozilla/5.0' }, baseURL: 'https://www.cjoint.com/' });
    const uploadUrl = await getUploadUrl(instance);
    const uploadResponse = await uploadFile(outputFilePath, uploadUrl, instance);
    const cjointLink = await getCjointLink(uploadResponse);
    const finalUrl = await getFinalUrl(cjointLink);
    const transferResponse = await savelink.saveAndTransfer(finalUrl);
    addToLibrary({ title, finalUrl });
    fs.unlink(inputFilePath, () => {});
    fs.unlink(outputFilePath, () => {});
    return transferResponse;
}

function convertMp3ToM4a(input, output) {
    return new Promise((resolve, reject) => {
        ffmpeg(input).toFormat('mp3').on('end', resolve).on('error', reject).save(output);
    });
}

async function getUploadUrl(instance) {
    const response = await instance.get('/');
    const $ = cheerio.load(response.data);
    return $('#form-upload').attr('action');
}

async function uploadFile(filePath, uploadUrl, instance) {
    const formData = new FormData();
    formData.append('USERFILE', fs.createReadStream(filePath));
    const response = await instance.post(uploadUrl, formData, { headers: formData.getHeaders() });
    return response.data;
}

async function getCjointLink(uploadResponse) {
    const $ = cheerio.load(uploadResponse);
    return $('.share_url a').attr('href');
}

async function getFinalUrl(cjointLink) {
    const instance = axios.create({ headers: { 'User-Agent': 'Mozilla/5.0' }, baseURL: cjointLink });
    const htmlResponse = await instance.get('/');
    const html$ = cheerio.load(htmlResponse.data);
    const shareUrl = html$('.share_url a').attr('href');
    return `https://www.cjoint.com${shareUrl.split('"')[0]}`;
}

function addToLibrary(data) {
    let library = [];
    if (fs.existsSync(libraryPath)) {
        const existingData = fs.readFileSync(libraryPath, 'utf8');
        library = JSON.parse(existingData);
    }
    library.push(data);
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf8');
}

app.get('/api/jonell', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });
    try {
        const transferResponse = await downloadAndUploadMusic(url);
        res.json(transferResponse);
    } catch (error) {
        res.status(500).json({ error: 'An error occurred', details: error.message });
    }
});

app.get('/api/library', async (req, res) => {
    try {
        if (!fs.existsSync(libraryPath)) {
            return res.json([]);
        }
        const library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
        res.json(library);
    } catch (error) {
        res.status(500).json({ error: 'Error reading library', details: error.message });
    }
});

app.listen(3000, () => console.log('Server is running on http://localhost:3000'));
