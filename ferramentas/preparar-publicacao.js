/* =====================================================================
   Preparar a publicação (opcional) — node ferramentas/preparar-publicacao.js
   ---------------------------------------------------------------------
   Calcula o carimbo da casca (hash dos arquivos essenciais do Service
   Worker), grava em version.js (CARIMBO_CASCA) e roda a conferência.

   Publicar sem rodar isto continua funcionando: a versão nova do
   changelog já troca o nome do cache. O carimbo só garante que uma
   mudança de arquivo da casca sem versão nova também troque o cache —
   e a conferência acusa quando o carimbo ficou para trás.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const { carimboDaCasca, essenciais } = require("./conferir-publicacao.js");

const arquivo = path.join(RAIZ, "version.js");
const texto = fs.readFileSync(arquivo, "utf8");
const carimbo = carimboDaCasca(essenciais);
const novo = texto.replace(/var CARIMBO_CASCA = "[^"]*";/, 'var CARIMBO_CASCA = "' + carimbo + '";');
if (novo === texto) console.log("Carimbo da casca já estava em dia: " + carimbo);
else { fs.writeFileSync(arquivo, novo); console.log("Carimbo da casca gravado em version.js: " + carimbo); }

try { execFileSync(process.execPath, [path.join(__dirname, "conferir-publicacao.js")], { stdio: "inherit" }); }
catch (e) { process.exit(1); }
