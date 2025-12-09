// emailClient.js

async function enviarEmailIncidencia({ asunto, cuerpo }) {
  console.log('---------------- EMAIL INCIDENCIA (SIMULADO) ----------------');
  console.log('Asunto:', asunto);
  console.log('Cuerpo:\n', cuerpo);
  console.log('----------------------------------------------------------------');
}

module.exports = { enviarEmailIncidencia };
