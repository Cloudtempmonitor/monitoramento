// =========================================
// ADMIN-HIERARCHY.JS 
// =========================================

// Importações do Firebase 
import { collection, doc, setDoc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

import { showNotification } from 'utils/notifications.js';

let db, currentUserLevel, currentUserInstitutions, hierarchyCache, loadHierarchyCache;

let currentSelectedInstId = null;
let currentSelectedUnitId = null;


const contentArea = document.getElementById('admin-content-area');
const adminTitle = document.getElementById('admin-title');

export function initHierarchyModule(dependencies) {
    db = dependencies.db;
    currentUserLevel = dependencies.currentUserLevel;
    currentUserInstitutions = dependencies.currentUserInstitutions;
    hierarchyCache = dependencies.hierarchyCache;
    loadHierarchyCache = dependencies.loadHierarchyCache; 
}


export async function showInstituicoesView() {
    adminTitle.textContent = "Gerenciar Hierarquia";
    currentSelectedInstId = null;
    currentSelectedUnitId = null;
    
    let newButtonHtml = '';
    if (currentUserLevel === 'superAdmin') {
        newButtonHtml = `<button id="add-new-inst" class="admin-button-new">Adicionar Instituição</button>`;
    }

    contentArea.innerHTML = `
        ${newButtonHtml}
        <div class="hierarchy-container">
            <div class="column" id="col-instituicoes">
                <h4>Instituições</h4>
                <ul id="inst-list" class="hierarchy-list"></ul>
            </div>
            <div class="column" id="col-unidades">
                <h4>Unidades</h4>
                <button id="add-new-unit" class="admin-button-new-small" style="display:none;">+ Adicionar Unidade</button>
                <ul id="unit-list" class="hierarchy-list"></ul>
            </div>
            <div class="column" id="col-setores">
                <h4>Setores</h4>
                <button id="add-new-setor" class="admin-button-new-small" style="display:none;">+ Adicionar Setor</button>
                <ul id="setor-list" class="hierarchy-list"></ul>
            </div>
        </div>
    `;

    if (currentUserLevel === 'superAdmin') {
        document.getElementById('add-new-inst').addEventListener('click', () => openHierarchyModal('instituicao'));
    }
    document.getElementById('add-new-unit').addEventListener('click', () => openHierarchyModal('unidade'));
    document.getElementById('add-new-setor').addEventListener('click', () => openHierarchyModal('setor'));

    renderInstituicoes();
}

function renderInstituicoes() {
    const list = document.getElementById('inst-list');
    list.innerHTML = '';
    
    let instituicoesPermitidas = [];
    if (currentUserLevel === 'superAdmin') {
        instituicoesPermitidas = hierarchyCache.instituicoes;
    } else {
        instituicoesPermitidas = hierarchyCache.instituicoes.filter(inst => 
            currentUserInstitutions.includes(inst.id)
        );
    }

    instituicoesPermitidas.forEach(inst => {
        const li = document.createElement('li');
        li.textContent = inst.nome || inst.id;
        li.dataset.id = inst.id;
        li.addEventListener('click', () => {
            list.querySelectorAll('li').forEach(item => item.classList.remove('active'));
            li.classList.add('active');
            
            currentSelectedInstId = inst.id;
            currentSelectedUnitId = null;
            document.getElementById('add-new-unit').style.display = 'block';
            document.getElementById('add-new-setor').style.display = 'none';
            document.getElementById('setor-list').innerHTML = '';
            renderUnidades(inst.id);
        });
        
        const editBtn = document.createElement('span');
        editBtn.className = 'edit-btn';
        editBtn.textContent = 'Editar';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openHierarchyModal('instituicao', inst.id);
        };
        li.appendChild(editBtn);
        
        list.appendChild(li);
    });
}

function renderUnidades(instId) {
    const list = document.getElementById('unit-list');
    list.innerHTML = '';
    
    hierarchyCache.unidades
        .filter(unit => unit.instituicaoId === instId)
        .forEach(unit => {
            const li = document.createElement('li');
            li.textContent = unit.nome || unit.id;
            li.dataset.id = unit.id;
            li.addEventListener('click', () => {
                list.querySelectorAll('li').forEach(item => item.classList.remove('active'));
                li.classList.add('active');

                currentSelectedUnitId = unit.id;
                document.getElementById('add-new-setor').style.display = 'block';
                renderSetores(unit.id);
            });
            
            const editBtn = document.createElement('span');
            editBtn.className = 'edit-btn';
            editBtn.textContent = 'Editar';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                openHierarchyModal('unidade', unit.id);
            };
            li.appendChild(editBtn);

            list.appendChild(li);
        });
}

function renderSetores(unitId) {
    const list = document.getElementById('setor-list');
    list.innerHTML = '';
    
    hierarchyCache.setores
        .filter(setor => setor.unidadeId === unitId)
        .forEach(setor => {
            const li = document.createElement('li');
            li.textContent = setor.nome || setor.id;
            li.dataset.id = setor.id;

            const editBtn = document.createElement('span');
            editBtn.className = 'edit-btn';
            editBtn.textContent = 'Editar';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                openHierarchyModal('setor', setor.id);
            };
            li.appendChild(editBtn);
            
            list.appendChild(li);
        });
}

async function openHierarchyModal(type, docId = null) {
    let data = {};
    let title = '';
    
    if (type === 'instituicao') {
        title = docId ? 'Editar Instituição' : 'Nova Instituição';
        if(docId) data = hierarchyCache.instituicoes.find(i => i.id === docId) || {};
    } else if (type === 'unidade') {
        title = docId ? 'Editar Unidade' : 'Nova Unidade';
        if(docId) data = hierarchyCache.unidades.find(u => u.id === docId) || {};
    } else {
        title = docId ? 'Editar Setor' : 'Novo Setor';
        if(docId) data = hierarchyCache.setores.find(s => s.id === docId) || {};
    }

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'admin-modal-overlay';
    const modalContent = document.createElement('div');
    modalContent.className = 'admin-modal-content';
    
    modalContent.innerHTML = `
        <h3>${title}</h3>
        <form id="hierarchy-form">
            <div class="form-group">
                <label for="nome">Nome</label>
                <input type="text" id="nome" value="${data.nome || ''}" required>
            </div>
            
            ${type === 'instituicao' ? `
                <div class="form-group">
                    <label for="cnpj">CNPJ</label>
                    <input type="text" id="cnpj" value="${data.cnpj || ''}">
                </div>
                <div class="form-group">
                    <label for="endereco">Endereço</label>
                    <input type="text" id="endereco" value="${data.endereco || ''}">
                </div>
            ` : ''}

            <div class="form-actions">
                ${docId && currentUserLevel === 'superAdmin' ? 
                    `<button type="button" class="admin-button-delete" id="delete-hierarchy-btn">Excluir</button>` 
                    : ''}
                <button type="button" class="admin-button-cancel" style="margin-left: auto;">Cancelar</button>
                <button type="submit" class="admin-button-save">Salvar</button>
            </div>
        </form>
    `;
    
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    modalOverlay.querySelector('.admin-button-cancel').addEventListener('click', () => {
        document.body.removeChild(modalOverlay);
    });
    
    modalOverlay.querySelector('#hierarchy-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveHierarchyDoc(type, docId);
    });

    if (docId && currentUserLevel === 'superAdmin') {
        modalOverlay.querySelector('#delete-hierarchy-btn').addEventListener('click', () => {
            deleteHierarchyDoc(type, docId);
        });
    }
}

async function saveHierarchyDoc(type, docId) {
    const isNew = !docId;
    const nome = document.getElementById('nome').value;
    if (!nome) {
        showNotification("O nome é obrigatório.", 'error', 'Erro');
        return;
    }
    
    let collectionName;
    if (type === 'instituicao') {
        collectionName = 'instituicoes';
    } else if (type === 'unidade') {
        collectionName = 'unidades';
    } else if (type === 'setor') {
        collectionName = 'setores';
    } else {
        console.error("Tipo de hierarquia desconhecido:", type);
        return;
    }
    
    let data = { nome: nome };
    let ref;

    try {
        if (isNew) {
            ref = doc(collection(db, collectionName));
            if (type === 'unidade') {
                if (!currentSelectedInstId) {
                    showNotification("Erro: Nenhuma instituição selecionada.", 'error', 'Erro');
                    return;
                }
                data.instituicaoId = currentSelectedInstId;
            } else if (type === 'setor') {
                if (!currentSelectedInstId || !currentSelectedUnitId) {
                    showNotification("Erro: Nenhuma instituição ou unidade selecionada.", 'error', 'Erro');
                    return;
                }
                data.instituicaoId = currentSelectedInstId;
                data.unidadeId = currentSelectedUnitId;
            }
        } else {
            ref = doc(db, collectionName, docId);
        }

        if (type === 'instituicao') {
            data.cnpj = document.getElementById('cnpj').value;
            data.endereco = document.getElementById('endereco').value;
        }
        
        if (isNew) {
            await setDoc(ref, data);
        } else {
            await updateDoc(ref, data);
        }

        showNotification(`${type} salvo com sucesso!`, 'success', 'Sucesso');
        document.body.removeChild(document.querySelector('.admin-modal-overlay'));
                
        await loadHierarchyCache();
        showInstituicoesView(); 

    } catch (error) {
        console.error(`Erro ao salvar ${type}:`, error);
        showNotification(`Erro ao salvar: ${error.message}`, 'error', 'Erro');
    }
}

async function deleteHierarchyDoc(type, docId) {
    if (currentUserLevel !== 'superAdmin') {
        showNotification("Acesso negado.", 'error', 'Erro');
        return;
    }

    let collectionName;
    if (type === 'instituicao') {
        collectionName = 'instituicoes';
    } else if (type === 'unidade') {
        collectionName = 'unidades';
    } else if (type === 'setor') {
        collectionName = 'setores';
    } else {
        console.error("Tipo de hierarquia desconhecido:", type);
        return;
    }

    const confirmed = await showConfirmation(`Tem certeza que deseja excluir este ${type}? AVISO: Isso NÃO excluirá itens filhos (unidades, setores, dispositivos) automaticamente.`, 'Confirmar Exclusão');
    if (!confirmed) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, collectionName, docId));
        showNotification(`${type} excluído com sucesso.`, 'success', 'Sucesso');
        
        document.body.removeChild(document.querySelector('.admin-modal-overlay'));
        
        await loadHierarchyCache();
        showInstituicoesView(); 

    } catch (error) {
        console.error(`Erro ao excluir ${type}:`, error);
        showNotification(`Erro ao excluir: ${error.message}`, 'error', 'Erro');
    }
}



