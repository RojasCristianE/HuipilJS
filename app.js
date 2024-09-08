import TelegramBot from "node-telegram-bot-api";

const {TOKEN} = process.env;

const userId = 1538453625;

const message =
    "Lo siento, parece que hubo un error con tu mensaje anterior. Por qué no intentas enviar una foto de nuevo y me permites intentarlo de nuevo?.";

const bot = new TelegramBot(TOKEN, { polling: false });

bot.sendMessage(userId, message)
    .then(() => {
        console.log(`Mensaje enviado al usuario ${userId}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("Error al enviar el mensaje:", error);
        process.exit(1);
    });