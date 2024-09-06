import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import express from "express";
import axios from 'axios';
import TelegramBot from "node-telegram-bot-api";
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const { TOKEN, DOMAIN, PORT } = process.env;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMG_ROUTE = path.join(__dirname, 'public');
const watermarkPath = path.join(IMG_ROUTE, 'wm.png');

const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${DOMAIN}/bot${TOKEN}`);

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://kwai-kolors-kolors-virtual-try-on.hf.space/', { waitUntil: 'networkidle2' });

const app = express();

app.use(express.json());

let isProcessing = false;
let lastErrorTime = 0;
let WAIT_TIME = 600000;

app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/public/:subfolder/:filename', ({ params: { subfolder, filename } }, res) => {
    const filePath = path.join(IMG_ROUTE, subfolder, filename);

    fs.access(filePath, fs.constants.F_OK, err => {
        if (err) res.status(404).json({ error: 'File not found' });
        else res.sendFile(filePath);
    });
});

app.listen(PORT, () => console.log(`Express server is listening on ${PORT}`));

bot.on('message', async ({ message_id, text, photo, from: { id, username, first_name } }) => {
    console.log("\n" + new Date().toLocaleString());
    console.log(`Procesando mensaje de: ${username ? `https://t.me/${username}` : `tg://user?id=${id}`}`);

    if (photo) {

        const photoId = photo[photo.length - 1].file_id;
        const uPhoto = await bot.getFile(photoId);
        const url = `https://api.telegram.org/file/bot${TOKEN}/${uPhoto.file_path}`;
        const imgName = `${username || id}_${message_id}`;
        const imgPath = path.join(IMG_ROUTE, "users", `${imgName}.jpg`);

        const writer = fs.createWriteStream(imgPath);

        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    const currentTime = Date.now();
    const recentError = (currentTime - lastErrorTime) < WAIT_TIME;

    console.log("\n\n" + new Date().toLocaleString());
    console.log(`Procesando mensaje de: ${msg.from.username ? `https://t.me/${msg.from.username}` : `tg://user?id=${msg.from.id}`}`);

    if (/^\/start/.test(text)) {
        bot.sendMessage(id, `¡Hola, ${first_name}! Envíame una foto y te mostraré cómo te verías con un tradicional huipil.`);

        return;
    } else if (photo) {
        console.log("Foto recibida");
        if (recentError) {
            await bot.sendMessage(id, "Actualmente estamos procesando una alta cantidad de solicitudes. Intenta nuevamente en unos minutos. ¡Gracias por tu paciencia!");

            return;
        }

        if (isProcessing) {
            await bot.sendMessage(id, "Estoy procesando otra solicitud en este momento. Intenta de nuevo en unos minutos.");

            return;
        }

        await bot.sendMessage(id, "¡Linda foto!\n\nAhora solo espera unos minutos para recibir tu foto");

        isProcessing = true;

        const photoId = msg.photo[msg.photo.length - 1].file_id;

        try {
            const photo = await bot.getFile(photoId);
            const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${photo.file_path}`;
            const imgName = `${msg.from.username || msg.from.id}_${msg.message_id}`;
            const imgPath = path.join(IMG_ROUTE, "users", `${imgName}.jpg`);

            const writer = fs.createWriteStream(imgPath);

            const response = await axios({
                url: fileUrl,
                method: 'GET',
                responseType: 'stream'
            });
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            const i = Math.ceil(Math.random() * 10);

            const person = await axios.get(`${DOMAIN}/public/users/${imgName}.jpg`, { responseType: 'arraybuffer' });
            const garment = await axios.get(`${DOMAIN}/public/clothes/${i}.png`, { responseType: 'arraybuffer' });
            const person_img = await person.data;
            const garment_img = await garment.data;
            const payload = { person_img, garment_img };

            const client = await Client.connect("Kwai-Kolors/Kolors-Virtual-Try-On");
            const result = await client.predict("/tryon", payload);

            const imgResponse = await axios({
                url: result.data[0].url,
                method: 'GET',
                responseType: 'arraybuffer',
            });

            const watermarkBuffer = await fs.promises.readFile(watermarkPath);

            const image = sharp(imgResponse.data);
            const watermark = sharp(watermarkBuffer);

            const { width } = await image.metadata();

            const input = await watermark.resize({ width }).toBuffer();

            const finalImage = await image.composite([{ input, gravity: 'south' }]).toFormat('jpg').toBuffer();

            await bot.sendPhoto(id, finalImage, {
                caption: "Aquí tenés tu foto.\n\n¡Feliz día del Huipil!"
            });

            const transformedImgPath = path.join(IMG_ROUTE, "transformed", `${imgName}.jpg`);
            await fs.promises.writeFile(transformedImgPath, finalImage);
        } catch (error) {
            lastErrorTime = currentTime;

            console.error("Error en la solicitud:", error);

            await bot.sendMessage(id, "Actualmente estamos procesando una alta cantidad de solicitudes. Intenta nuevamente en unos minutos. ¡Gracias por tu paciencia!");
        } finally {
            isProcessing = false;
        }
    } else {
        bot.sendMessage(id, "¡Lo siento! Solo puedo procesar comandos o fotos.");
    }
});