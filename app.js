// whatsapp-bot/app.js

// 1. Importamos express
const express = require('express');

// 2. Creamos la app
const app = express();

// 3. Puerto donde escucha el bot de WhatsApp
//    Lo separamos del otro microservicio para que no haya conflicto.
//    Por ejemplo, el otro usa 3000 y este usa 4000.
const PORT = process.env.PORT || 4000;

// 4. Middleware para leer JSON en el cuerpo de las peticiones
app.use(express.json());

// 5. Endpoint de prueba
//    GET http://localhost:4000/ping
app.get('/ping', (req, res) => {
  res.json({ mensaje: 'pong desde whatsapp-bot' });
});

// 6. Webhook de WhatsApp (todavía sin IA, solo para ver que llega algo)
//    POST http://localhost:4000/webhook/whatsapp
app.post('/webhook/whatsapp', (req, res) => {
  console.log('📩 Mensaje recibido en /webhook/whatsapp');
  console.log(JSON.stringify(req.body, null, 2));

  // WhatsApp (o el proveedor que uses) solo necesita que devolvamos 200 rápido
  res.sendStatus(200);
});

// 7. Arrancamos el servidor
app.listen(PORT, () => {
  console.log(`whatsapp-bot escuchando en el puerto ${PORT}`);
});
