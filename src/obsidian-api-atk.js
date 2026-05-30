// ============================================
// OBSIDIAN API — Acesso ao vault via GitHub API
// Permite Jarvis ler/buscar/atualizar notas
// mesmo com PC desligado (24/7)
// ============================================
const CONFIG = require("./config-atk");
const { Octokit } = require("@octokit/rest");

const OWNER = "mironrodriguescostaneto-cell";
const REPO = "obsidian-vault";
const BRANCH = "main";

let _octokit;
function getOctokit() {
  if (_octokit) return _octokit;
  const token = CONFIG.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN nao configurado");
  _octokit = new Octokit({ auth: token });
  return _octokit;
}

// Ler conteudo de uma nota
async function lerNota(caminho) {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: caminho,
      ref: BRANCH,
    });
    if (data.type !== "file") return `ERRO: ${caminho} e um diretorio, nao um arquivo`;
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return content;
  } catch (e) {
    if (e.status === 404) return `ERRO: Nota nao encontrada: ${caminho}`;
    return `ERRO ao ler nota: ${e.message}`;
  }
}

// Listar notas de um diretorio
async function listarNotas(diretorio = "") {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path: diretorio || "",
      ref: BRANCH,
    });
    if (!Array.isArray(data)) return `${diretorio} e um arquivo, nao diretorio`;
    return data
      .filter(item => !item.name.startsWith("."))
      .map(item => `${item.type === "dir" ? "📁" : "📄"} ${item.name}`)
      .join("\n");
  } catch (e) {
    if (e.status === 404) return `ERRO: Diretorio nao encontrado: ${diretorio}`;
    return `ERRO ao listar: ${e.message}`;
  }
}

// Buscar texto em notas (busca no GitHub via API)
async function buscarObsidian(termo, diretorio = "") {
  try {
    const octokit = getOctokit();
    // GitHub code search
    const query = `${termo} repo:${OWNER}/${REPO}${diretorio ? ` path:${diretorio}` : ""} extension:md`;
    const { data } = await octokit.search.code({ q: query, per_page: 10 });
    if (data.total_count === 0) return `Nenhum resultado para "${termo}" no Obsidian`;
    const results = [];
    for (const item of data.items) {
      results.push(`📄 ${item.path} (score: ${item.score?.toFixed(1) || "?"})`);
    }
    return `${data.total_count} resultados para "${termo}":\n${results.join("\n")}`;
  } catch (e) {
    return `ERRO na busca: ${e.message}`;
  }
}

// Atualizar/criar nota no Obsidian (via GitHub API)
async function atualizarNota(caminho, conteudo, mensagemCommit) {
  try {
    const octokit = getOctokit();
    let sha;
    // Tentar pegar SHA existente (para update)
    try {
      const { data } = await octokit.repos.getContent({
        owner: OWNER,
        repo: REPO,
        path: caminho,
        ref: BRANCH,
      });
      sha = data.sha;
    } catch (e) {
      if (e.status !== 404) {
        return `ERRO ao verificar nota existente: ${e.message}`;
      }
      // 404 = arquivo novo, sem SHA, ok continuar
    }
    const params = {
      owner: OWNER,
      repo: REPO,
      path: caminho,
      message: mensagemCommit || `[Jarvis] Atualizar ${caminho}`,
      content: Buffer.from(conteudo, "utf8").toString("base64"),
      branch: BRANCH,
    };
    if (sha) params.sha = sha;
    await octokit.repos.createOrUpdateFileContents(params);
    return `OK: Nota ${sha ? "atualizada" : "criada"} com sucesso: ${caminho}`;
  } catch (e) {
    return `ERRO ao ${sha ? "atualizar" : "criar"} nota: ${e.message}`;
  }
}

// Ler arquivo do repo atacadao-sistema via GitHub
async function lerCodigoGithub(caminho) {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({
      owner: OWNER,
      repo: "atacadao-sistema",
      path: caminho,
      ref: "main",
    });
    if (data.type !== "file") return `ERRO: ${caminho} e um diretorio`;
    const content = Buffer.from(data.content, "base64").toString("utf8");
    const lines = content.split("\n");
    if (lines.length > 200) {
      return lines.slice(0, 200).map((l, i) => `${i+1}: ${l}`).join("\n") + `\n\n[TRUNCADO: ${lines.length} linhas total]`;
    }
    return lines.map((l, i) => `${i+1}: ${l}`).join("\n");
  } catch (e) {
    if (e.status === 404) return `ERRO: Arquivo nao encontrado no GitHub: ${caminho}`;
    return `ERRO: ${e.message}`;
  }
}

// Ver commits recentes do atacadao-sistema
async function verCommitsRecentes(quantidade = 10) {
  try {
    const qty = Math.min(Math.max(quantidade || 10, 1), 30);
    const octokit = getOctokit();
    const { data } = await octokit.repos.listCommits({
      owner: OWNER,
      repo: "atacadao-sistema",
      per_page: qty,
    });
    return data.map(c => {
      const date = new Date(c.commit.author.date).toLocaleDateString("pt-BR");
      return `[${date}] ${c.sha.slice(0,7)} — ${c.commit.message.split("\n")[0]}`;
    }).join("\n");
  } catch (e) {
    return `ERRO: ${e.message}`;
  }
}

module.exports = {
  lerNota,
  listarNotas,
  buscarObsidian,
  atualizarNota,
  lerCodigoGithub,
  verCommitsRecentes,
};
