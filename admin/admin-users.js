// =========================================
// ADMIN-USERS.JS
// =========================================

// Importações do Firebase
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { showNotification, showConfirmation } from "../utils/notifications.js";

// --- Variáveis de Dependência (preenchidas pelo init) ---
let db, auth, currentUserLevel, currentUserInstitutions, hierarchyCache;
let loggedInUserId;

// --- Elementos da DOM ---
const contentArea = document.getElementById("admin-content-area");
const adminTitle = document.getElementById("admin-title");

/**
 * Recebe as dependências do admin.js principal
 */
export function initUsersModule(dependencies) {
  db = dependencies.db;
  auth = dependencies.auth;
  currentUserLevel = dependencies.currentUserLevel;
  currentUserInstitutions = dependencies.currentUserInstitutions;
  hierarchyCache = dependencies.hierarchyCache;
  loggedInUserId = dependencies.currentUserId;
}

/**
 * Função principal da view (EXPORTADA)
 */
export async function showUsuariosView() {
  adminTitle.textContent = "Gerenciar Usuários";
  contentArea.innerHTML = `<p>Carregando usuários...</p>`;

  let usersQuery;

  if (currentUserLevel === "superAdmin") {
    usersQuery = query(collection(db, "usuarios"));
  } else {
    if (currentUserInstitutions.length === 0) {
      contentArea.innerHTML =
        "<p>Você não tem acesso a nenhuma instituição.</p>";
      return;
    }
    usersQuery = query(
      collection(db, "usuarios"),
      where("acessoInstituicoes", "array-contains-any", currentUserInstitutions)
    );
  }

  const snapshot = await getDocs(usersQuery);
  const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  let tableHtml = `
        <button id="add-new-user" class="admin-button-new">Adicionar Novo Usuário</button>
        <table id="admin-table">
            <thead>
                <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Nível</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
                ${users
                  .map(
                    (user) => `
                    <tr>
                        <td>${user.nome || "Sem nome"}</td>
                        <td>${user.email || "N/A"}</td>
                        <td>${user.nivel || "N/A"}</td>
                        <td class="admin-actions">
                            <button class="admin-button-edit" data-id="${
                              user.id
                            }">Editar</button>
                            ${
                              currentUserLevel === "superAdmin"
                                ? `<button class="admin-button-delete" data-id="${user.id}" data-email="${user.email}">Excluir</button>`
                                : ""
                            }
                        </td>
                    </tr>
                `
                  )
                  .join("")}
            </tbody>
        </table>
    `;

  contentArea.innerHTML = tableHtml;

  document
    .getElementById("add-new-user")
    .addEventListener("click", () => openUserModal(null));

  document.querySelectorAll(".admin-button-edit").forEach((button) => {
    button.addEventListener("click", (e) => openUserModal(e.target.dataset.id));
  });

  if (currentUserLevel === "superAdmin") {
    document.querySelectorAll(".admin-button-delete").forEach((button) => {
      button.addEventListener("click", async (e) => {
        const id = e.target.dataset.id;
        const email = e.target.dataset.email;

        const confirmed = await showConfirmation(
          `Tem certeza que deseja excluir o usuário <b>${email}</b>?<br><small>(O login no Auth não será excluído automaticamente.)</small>`,
          "Excluir Usuário"
        );

        if (confirmed) {
          await deleteUserFirestore(id, email);
        }
      });
    });
  }
}

/**
 * ========================================
 * MODAL DE USUÁRIOS
 * ========================================
 */

// --- Variáveis de estado para a árvore de acesso ---
let selectedInst = new Set();
let selectedUnit = new Set();
let selectedSetor = new Set();
let selectedDispositivo = new Set();

/**
 * Abre o Modal para CRIAR ou EDITAR um Usuário.
 */
async function openUserModal(userId) {
  let user = {};

   if (userId) {
    const docRef = doc(db, "usuarios", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      user = docSnap.data();
    }
  }
  
  if (currentUserLevel === "admin") {
    // Se tentar editar outro admin ou superAdmin que não é ele mesmo
    if (
      user.nivel === "superAdmin" ||
      (user.nivel === "admin" && userId !== loggedInUserId)
    ) {
      showNotification(
        "Você não tem permissão para editar este usuário.",
        "error"
      );
      return;
    }
  }
 

  selectedInst = new Set(user.acessoInstituicoes || []);
  selectedUnit = new Set(user.acessoUnidades || []);
  selectedSetor = new Set(user.acessoSetores || []);
  selectedDispositivo = new Set(user.acessoDispositivos || []);

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "admin-modal-overlay";
  const modalContent = document.createElement("div");
  modalContent.className = "admin-modal-content";

  let nivelOptions = "";
  if (currentUserLevel === "superAdmin") {
    nivelOptions = `
            <option value="operador" ${
              user.nivel === "operador" ? "selected" : ""
            }>Operador</option>
            <option value="admin" ${
              user.nivel === "admin" ? "selected" : ""
            }>Admin</option>
            <option value="superAdmin" ${
              user.nivel === "superAdmin" ? "selected" : ""
            }>Super Admin</option>
        `;
  } else {
    if (userId === loggedInUserId) {
      nivelOptions = `
            <option value="admin" selected>Admin</option>
        `;
    } else {
      nivelOptions = `
            <option value="operador" ${
              user.nivel === "operador" ? "selected" : ""
            }>Operador</option>
        `;
    }
  }

  // ==============================================================
  // ===  Lógica de Senha ===
  // ==============================================================

  const isNewUser = !userId;
  let canEditPassword = false;

  if (!isNewUser) {
    if (currentUserLevel === "superAdmin") {
      canEditPassword = true;
    } else if (currentUserLevel === "admin" && userId === loggedInUserId) {
      canEditPassword = true;
    }
  }

  // Regras de senha para o tooltip
  const passwordRules =
    "Deve ter mín. 6 caracteres, 1 maiúscula, 1 minúscula, 1 número e 1 caractere especial (ex: @, $, !, %, *, ?, &).";

  let passwordHtml = "";
  if (isNewUser) {
    passwordHtml = `
            <div class="form-group">
                <label for="senha" title="${passwordRules}">Senha</label>
                <input type="password" id="senha" required>
            </div>
            <div class="form-group">
                <label for="senha-confirm">Confirmar Senha</label>
                <input type="password" id="senha-confirm" required>
            </div>
        `;
  } else if (canEditPassword) {
    passwordHtml = `
            <hr>
            <h4>Redefinir Senha (Opcional)</h4>
            <div class="form-group">
                <label for="senha" title="${passwordRules}">Nova Senha</label>
                <input type="password" id="senha">
            </div>
            <div class="form-group">
                <label for="senha-confirm">Confirmar Nova Senha</label>
                <input type="password" id="senha-confirm">
            </div>
        `;
  }

  // Construção do HTML Final do Modal
  modalContent.innerHTML = `
        <h3>${userId ? "Editar Usuário" : "Novo Usuário"}</h3>
        <form id="user-form">
            <div class="form-group">
                <label for="nome">Nome</label>
                <input type="text" id="nome" value="${
                  user.nome || ""
                }" required>
            </div>
            <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" value="${user.email || ""}" ${
    userId ? "disabled" : ""
  } required>
            </div>
            <div class="form-group">
                <label for="select-nivel">Nível de Acesso</label>
                <select id="select-nivel" required>${nivelOptions}</select>
            </div>
            
            ${passwordHtml}
            
            <div class="form-group">
                <label for="chatId">Chat ID do Telegram (Opcional)</label>
                <input type="text" id="chatId" value="${user.chatId || ""}">
            </div>
            
            <div class="form-group">
                <label>Receber Alertas</label>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" id="alarmesAtivos" style="width: auto;" ${
                      user.alarmesAtivos !== false ? "checked" : ""
                    }>
                    <label for="alarmesAtivos" style="margin-bottom: 0; font-weight: normal; cursor: pointer;">
                        Ativar recebimento de alertas (ex: via Telegram)
                    </label>
                </div>
            </div>
            
            <hr style="clear:both;">
            <h4>Acessos (Clique no item para carregar os filhos)</h4>
            
            <div class="hierarchy-access-container">
                <div class="access-column">
                    <strong>Instituições</strong>
                    <ul id="access-inst-list" class="access-list"></ul>
                </div>
                <div class="access-column">
                    <strong>Unidades</strong>
                    <ul id="access-unit-list" class="access-list"></ul>
                </div>
                <div class="access-column">
                    <strong>Setores</strong>
                    <ul id="access-setor-list" class="access-list"></ul>
                </div>
                <div class="access-column">
                    <strong>Dispositivos</strong>
                    <ul id="access-dispositivo-list" class="access-list"></ul>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="button" class="admin-button-cancel">Cancelar</button>
                <button type="submit" class="admin-button-save">Salvar</button>
            </div>
        </form>
    `;

  modalOverlay.appendChild(modalContent);
  document.body.appendChild(modalOverlay);

  // --- Lógica da Árvore de Acesso ---
  renderAccessInstituicoes();

  // --- Ações do Modal ---
  modalOverlay
    .querySelector(".admin-button-cancel")
    .addEventListener("click", () => {
      document.body.removeChild(modalOverlay);
    });

  modalOverlay.querySelector("#user-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveUser(
      userId,
      selectedInst,
      selectedUnit,
      selectedSetor,
      selectedDispositivo
    );
  });
}

/**
 * ========================================
 * LÓGICA DA ÁRVORE DE ACESSO
 * ========================================
 */
function renderAccessInstituicoes() {
  const instList = document.getElementById("access-inst-list");
  instList.innerHTML = "";
  const { instituicoesPermitidas } = getPermittedHierarchy();
  instituicoesPermitidas.forEach((inst) => {
    const isChecked = selectedInst.has(inst.id);
    const li = createAccessListItem(inst.id, inst.nome, isChecked, "inst");
    li.addEventListener("click", (e) => {
      if (e.target.tagName !== "INPUT") {
        instList
          .querySelectorAll("li")
          .forEach((item) => item.classList.remove("active"));
        li.classList.add("active");
        renderAccessUnidades(inst.id);
      }
    });
    instList.appendChild(li);
  });
  document.getElementById("access-unit-list").innerHTML = "";
  document.getElementById("access-setor-list").innerHTML = "";
  document.getElementById("access-dispositivo-list").innerHTML = "";
}
function renderAccessUnidades(instId) {
  const unitList = document.getElementById("access-unit-list");
  unitList.innerHTML = "";
  const { unidadesPermitidas } = getPermittedHierarchy();
  unidadesPermitidas
    .filter((unit) => unit.instituicaoId === instId)
    .forEach((unit) => {
      const isChecked = selectedUnit.has(unit.id);
      const li = createAccessListItem(unit.id, unit.nome, isChecked, "unit", {
        instId,
      });
      li.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          unitList
            .querySelectorAll("li")
            .forEach((item) => item.classList.remove("active"));
          li.classList.add("active");
          renderAccessSetores(unit.id);
        }
      });
      unitList.appendChild(li);
    });
  document.getElementById("access-setor-list").innerHTML = "";
  document.getElementById("access-dispositivo-list").innerHTML = "";
}

function renderAccessSetores(unitId) {
  const setorList = document.getElementById("access-setor-list");
  setorList.innerHTML = "";
  const { setoresPermitidos } = getPermittedHierarchy();
  const unit = hierarchyCache.unidades.find((u) => u.id === unitId);
  setoresPermitidos
    .filter((setor) => setor.unidadeId === unitId)
    .forEach((setor) => {
      const isChecked = selectedSetor.has(setor.id);
      const li = createAccessListItem(
        setor.id,
        setor.nome,
        isChecked,
        "setor",
        { unitId, instId: unit.instituicaoId }
      );
      li.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          setorList
            .querySelectorAll("li")
            .forEach((item) => item.classList.remove("active"));
          li.classList.add("active");
          renderAccessDispositivos(setor.id);
        }
      });
      setorList.appendChild(li);
    });
  document.getElementById("access-dispositivo-list").innerHTML = "";
}

function renderAccessDispositivos(setorId) {
  const dispositivoList = document.getElementById("access-dispositivo-list");
  dispositivoList.innerHTML = "";
  const { dispositivosPermitidos } = getPermittedHierarchy();
  const dispositivos = dispositivosPermitidos.filter(
    (d) => d.setorID === setorId
  );

  if (dispositivos.length === 0) {
    dispositivoList.innerHTML =
      "<li><em>Nenhum dispositivo encontrado</em></li>";
    return;
  }

  dispositivos.forEach((dispositivo) => {
    const isChecked = selectedDispositivo.has(dispositivo.id);
    const li = createAccessListItem(
      dispositivo.id,
      dispositivo.nomeDispositivo || dispositivo.id,
      isChecked,
      "dispositivo",
      { setorId }
    );
    dispositivoList.appendChild(li);
  });
}

function createAccessListItem(id, name, isChecked, type, parentIds = {}) {
  const li = document.createElement("li");
  li.innerHTML = `
        <input type="checkbox" data-id="${id}" ${isChecked ? "checked" : ""}>
        <label>${name || id}</label>
    `;
  const checkbox = li.querySelector("input");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      cascadeCheck(id, type, parentIds);
    } else {
      cascadeCheck(id, type, parentIds, false);
      bubbleUncheck(id, type, parentIds);
    }
    refreshAccessTreeUI();
  });
  return li;
}
function cascadeCheck(id, type, parentIds, check = true) {
  if (check) {
    if (type === "inst") selectedInst.add(id);
    if (type === "unit") selectedUnit.add(id);
    if (type === "setor") selectedSetor.add(id);
    if (type === "dispositivo") selectedDispositivo.add(id);
  } else {
    if (type === "inst") selectedInst.delete(id);
    if (type === "unit") selectedUnit.delete(id);
    if (type === "setor") selectedSetor.delete(id);
    if (type === "dispositivo") selectedDispositivo.delete(id);
  }

  if (type === "inst") {
    hierarchyCache.unidades
      .filter((unit) => unit.instituicaoId === id)
      .forEach((unit) => cascadeCheck(unit.id, "unit", { instId: id }, check));
  }

  if (type === "unit") {
    hierarchyCache.setores
      .filter((setor) => setor.unidadeId === id)
      .forEach((setor) =>
        cascadeCheck(
          setor.id,
          "setor",
          { unitId: id, instId: parentIds.instId },
          check
        )
      );
  }

  if (type === "setor") {
    hierarchyCache.dispositivos
      .filter((dispositivo) => dispositivo.setorID === id)
      .forEach((dispositivo) =>
        cascadeCheck(
          dispositivo.id,
          "dispositivo",
          { setorID: id, unitId: parentIds.unitId, instId: parentIds.instId },
          check
        )
      );
  }
}

function bubbleUncheck(id, type, parentIds) {
  if (type === "dispositivo") {
    selectedSetor.delete(parentIds.setorId);
    bubbleUncheck(parentIds.setorId, "setor", {
      unitId: parentIds.unitId,
      instId: parentIds.instId,
    });
  }
  if (type === "setor") {
    selectedUnit.delete(parentIds.unitId);
    bubbleUncheck(parentIds.unitId, "unit", { instId: parentIds.instId });
  }
  if (type === "unit") {
    selectedInst.delete(parentIds.instId);
  }
}
function refreshAccessTreeUI() {
  document
    .querySelectorAll('#access-inst-list input[type="checkbox"]')
    .forEach((chk) => {
      chk.checked = selectedInst.has(chk.dataset.id);
    });
  document
    .querySelectorAll('#access-unit-list input[type="checkbox"]')
    .forEach((chk) => {
      chk.checked = selectedUnit.has(chk.dataset.id);
    });
  document
    .querySelectorAll('#access-setor-list input[type="checkbox"]')
    .forEach((chk) => {
      chk.checked = selectedSetor.has(chk.dataset.id);
    });
  document
    .querySelectorAll('#access-dispositivo-list input[type="checkbox"]')
    .forEach((chk) => {
      chk.checked = selectedDispositivo.has(chk.dataset.id);
    });
}
function getPermittedHierarchy() {
  let instituicoesPermitidas = [];
  let unidadesPermitidas = [];
  let setoresPermitidos = [];
  let dispositivosPermitidos = [];

  if (currentUserLevel === "superAdmin") {
    instituicoesPermitidas = hierarchyCache.instituicoes;
    unidadesPermitidas = hierarchyCache.unidades;
    setoresPermitidos = hierarchyCache.setores;
    dispositivosPermitidos = hierarchyCache.dispositivos || [];
  } else {
    instituicoesPermitidas = hierarchyCache.instituicoes.filter((inst) =>
      currentUserInstitutions.includes(inst.id)
    );
    unidadesPermitidas = hierarchyCache.unidades.filter((unit) =>
      currentUserInstitutions.includes(unit.instituicaoId)
    );
    setoresPermitidos = hierarchyCache.setores.filter((setor) =>
      currentUserInstitutions.includes(setor.instituicaoId)
    );
    dispositivosPermitidos = hierarchyCache.dispositivos.filter((dispositivo) =>
      currentUserInstitutions.includes(dispositivo.instituicaoID)
    );
  }

  return {
    instituicoesPermitidas,
    unidadesPermitidas,
    setoresPermitidos,
    dispositivosPermitidos,
  };
}

/**
 * ========================================
 * FIM DA LÓGICA DA ÁRVORE DE ACESSO
 * ========================================
 */

/**
 *Validador de Senha
 */
function validatePassword(password) {
  const errors = [];

  if (password.length < 6) {
    errors.push("Ter pelo menos 6 caracteres.");
  }
  if (!/(?=.*[a-z])/.test(password)) {
    errors.push("Ter pelo menos 1 letra minúscula.");
  }
  if (!/(?=.*[A-Z])/.test(password)) {
    errors.push("Ter pelo menos 1 letra maiúscula.");
  }
  if (!/(?=.*\d)/.test(password)) {
    errors.push("Ter pelo menos 1 número.");
  }
  if (!/(?=.*[@$!%*?&])/.test(password)) {
    errors.push(
      "Ter pelo menos 1 caractere especial (ex: @, $, !, %, *, ?, &)."
    );
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      message:
        "A senha não atende aos seguintes requisitos:<br><ul><li>" +
        errors.join("</li><li>") +
        "</li></ul>",
    };
  }
  return { isValid: true };
}

/**
 * Salva o usuário
 */
async function saveUser(
  userId,
  selectedInstSet,
  selectedUnitSet,
  selectedSetorSet,
  selectedDispositivoSet
) {
  const isNew = !userId;
  const email = document.getElementById("email").value;
  const nome = document.getElementById("nome").value;
  const nivel = document.getElementById("select-nivel").value;

  const senhaInput = document.getElementById("senha");
  const senhaConfirmInput = document.getElementById("senha-confirm");

  const senha = senhaInput ? senhaInput.value : "";
  const senhaConfirm = senhaConfirmInput ? senhaConfirmInput.value : "";

  const chatId = document.getElementById("chatId").value || null;
  const alarmesAtivos = document.getElementById("alarmesAtivos").checked;

  const acessoInstituicoes = Array.from(selectedInstSet);
  const acessoUnidades = Array.from(selectedUnitSet);
  const acessoSetores = Array.from(selectedSetorSet);
  const acessoDispositivos = Array.from(selectedDispositivoSet);

  try {
    let finalUserId = userId;
    let userData = {
      nome: nome,
      email: email,
      nivel: nivel,
      ativo: true,
      chatId: chatId,
      alarmesAtivos: alarmesAtivos,
      acessoInstituicoes: acessoInstituicoes,
      acessoUnidades: acessoUnidades,
      acessoSetores: acessoSetores,
      acessoDispositivos: acessoDispositivos,
    };

    if (isNew) {
      // --- Validação de Novo Usuário (senhas são obrigatórias) ---
      const validation = validatePassword(senha);
      if (!validation.isValid) {
        showNotification(validation.message, "error", "Senha Inválida");
        return;
      }
      if (senha !== senhaConfirm) {
        showNotification(
          "As senhas não conferem. Por favor, digite novamente.",
          "error"
        );
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        senha
      );
      finalUserId = userCredential.user.uid;

      const docRef = doc(db, "usuarios", finalUserId);
      await setDoc(docRef, userData);
      showNotification("Usuário criado com sucesso!", "success");
    } else {
      // --- Validação de Edição (senhas são opcionais) ---
      delete userData.email;

      if (senha || senhaConfirm) {
        // Se o usuário digitou em qualquer um dos campos...
        const validation = validatePassword(senha);
        if (!validation.isValid) {
          showNotification(validation.message, "error", "Senha Inválida");
          return;
        }
        if (senha !== senhaConfirm) {
          showNotification("As senhas para redefinição não conferem.", "error");
          return;
        }

        showNotification(
          "AVISO: A redefinição de senha de um usuário existente (Firebase Auth) requer uma Cloud Function (backend) por motivos de segurança. Os dados do usuário (Nome, Nível, Acessos) foram salvos, mas a senha NÃO foi alterada no sistema de login.",
          "info",
          "Aviso de Segurança"
        );
        // Futuramente chamar Cloud Function aqui
      }

      const docRef = doc(db, "usuarios", finalUserId);
      await updateDoc(docRef, userData);
      showNotification("Usuário atualizado com sucesso!", "success");
    }

    document.body.removeChild(document.querySelector(".admin-modal-overlay"));
    showUsuariosView();
  } catch (error) {
    if (error.code === "auth/email-already-in-use") {
      showNotification(
        "O email fornecido já está em uso por outra conta.",
        "error"
      );
    } else if (error.code === "auth/weak-password") {
      showNotification(
        "A senha fornecida é muito fraca (erro do Firebase).",
        "error"
      );
    } else {
      console.error("Erro ao salvar usuário:", error);
      showNotification(`Erro ao salvar: ${error.message}`, "error");
    }
  }
}

/**
 * Exclui um usuário do Firestore (APENAS superAdmin).
 */
async function deleteUserFirestore(userId, email) {
  if (currentUserLevel !== "superAdmin") {
    showNotification("Acesso negado.", "error");
    return;
  }

  try {
    await deleteDoc(doc(db, "usuarios", userId));
    showNotification(
      `Documento do usuário ${email} excluído do Firestore. O login (Auth) AINDA EXISTE.`,
      "info"
    );
    showUsuariosView();
  } catch (error) {
    console.error("Erro ao excluir documento do usuário:", error);
    showNotification(`Erro ao excluir: ${error.message}`, "error");
  }
}
