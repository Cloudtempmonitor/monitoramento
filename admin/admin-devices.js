// Importações do Firebase
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Dependências
let db, currentUserLevel, currentUserInstitutions, hierarchyCache;

// Elementos DOM
const contentArea = document.getElementById('admin-content-area');
const adminTitle = document.getElementById('admin-title');

export function initDevicesModule(dependencies) {
    ({ db, currentUserLevel, currentUserInstitutions, hierarchyCache } = dependencies);
}

export async function showDispositivosView() {
    adminTitle.textContent = "Gerenciar Dispositivos";
    contentArea.innerHTML = `<p>Carregando dispositivos...</p>`;
    
    const devicesQuery = currentUserLevel === 'superAdmin' 
        ? query(collection(db, "dispositivos"))
        : currentUserInstitutions.length > 0 
            ? query(collection(db, "dispositivos"), where("instituicaoID", "in", currentUserInstitutions))
            : null;

    if (!devicesQuery) {
        contentArea.innerHTML = "<p>Você não tem acesso a nenhuma instituição.</p>";
        return;
    }
    
    const snapshot = await getDocs(devicesQuery);
    const devices = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    contentArea.innerHTML = `
        <button id="add-new-device" class="admin-button-new">Adicionar Novo Dispositivo</button>
        <table id="admin-table">
            <thead><tr><th>Nome</th><th>MAC (ID)</th><th>Setor</th><th>Instituição</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>${devices.map(device => `
                <tr>
                    <td>${device.nomeDispositivo || 'Sem nome'}</td>
                    <td>${device.id}</td>
                    <td>${device.nomeSetor || 'N/A'}</td>
                    <td>${device.nomeInstituicao || 'N/A'}</td>
                    <td>${device.sondaAtiva === false ? '<span style="color: #e74c3c;">Sonda Inativa</span>' : '<span style="color: #2ecc71;">Sonda Ativa</span>'}</td>
                    <td class="admin-actions">
                        <button class="admin-button-edit" data-id="${device.id}">Editar</button>
                        ${currentUserLevel === 'superAdmin' ? `<button class="admin-button-delete" data-id="${device.id}">Excluir</button>` : ''}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
    
    document.getElementById('add-new-device').addEventListener('click', () => openDeviceModal(null));
    document.querySelectorAll('.admin-button-edit').forEach(btn => btn.addEventListener('click', e => openDeviceModal(e.target.dataset.id)));
    
    if (currentUserLevel === 'superAdmin') {
        document.querySelectorAll('.admin-button-delete').forEach(btn => btn.addEventListener('click', async e => {
            const id = e.target.dataset.id;
            if (confirm(`Tem certeza que deseja excluir o dispositivo ${id}?`)) await deleteDevice(id);
        }));
    }
}

async function openDeviceModal(deviceId) {
    let device = {};
    if (deviceId) {
        const docSnap = await getDoc(doc(db, "dispositivos", deviceId));
        if (docSnap.exists()) device = docSnap.data();
    }
    
    const isSondaAtiva = device.sondaAtiva !== false;
    const isAlarmeSondaAtivo = device.alarmeSondaAtivo !== false;
    const isAlarmeTempAmbienteAtivo = device.alarmeTempAmbienteAtivo !== false;
    const isAlarmeUmidadeAtivo = device.alarmeUmidadeAtivo !== false;

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'admin-modal-overlay';
    const modalContent = document.createElement('div');
    modalContent.className = 'admin-modal-content';
    
    modalContent.innerHTML = `
        <h3>${deviceId ? 'Editar Dispositivo' : 'Novo Dispositivo'}</h3>
        <form id="device-form">
            <div class="form-group"><label for="mac">MAC Address (ID)</label><input type="text" id="mac" value="${deviceId || ''}" ${deviceId ? 'disabled' : ''}>${!deviceId ? '<small>Após criado, o MAC não pode ser alterado.</small>' : ''}</div>
            <div class="form-group"><label for="nomeDispositivo">Nome do Dispositivo</label><input type="text" id="nomeDispositivo" value="${device.nomeDispositivo || ''}" required></div>
            
            <hr><h4>Hierarquia</h4>
            <div class="form-group"><label for="select-inst">Instituição</label><select id="select-inst" required></select></div>
            <div class="form-group"><label for="select-unit">Unidade</label><select id="select-unit" required></select></div>
            <div class="form-group"><label for="select-setor">Setor</label><select id="select-setor" required></select></div>
            
            <hr><h4>Configurações da Sonda</h4>
            <div class="form-group"><label>Sonda Externa (Sensor de Contato)</label><div style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="sondaAtiva" style="width: auto;" ${isSondaAtiva ? 'checked' : ''}><label for="sondaAtiva" style="margin-bottom: 0; font-weight: normal; cursor: pointer;">Sonda Ativa (Monitora temp. do sensor de contato)</label></div><small>Se desmarcado, o dashboard focará apenas na Temperatura e Umidade Ambiente.</small></div>

            <hr><h4>Limites de Alarme</h4>
            <div class="form-group"><div class="alarm-grid-container"><div class="alarm-grid"><span class="alarm-grid-header"><span>Tipo</span></span><span class="alarm-grid-header">Mínimo</span><span class="alarm-grid-header">Máximo</span><span class="alarm-grid-label">Sonda (°C)</span><input type="number" step="0.1" id="alarmeMin" value="${device.alarmeMin?.sonda || ''}" placeholder="Ex: 2.0"><input type="number" step="0.1" id="alarmeMax" value="${device.alarmeMax?.sonda || ''}" placeholder="Ex: 8.0"><span class="alarm-grid-label">Ambiente (°C)</span><input type="number" step="0.1" id="alarmeMinAmb" value="${device.alarmeMin?.temperaturaAmbiente || ''}" placeholder="Ex: 15.0"><input type="number" step="0.1" id="alarmeMaxAmb" value="${device.alarmeMax?.temperaturaAmbiente || ''}" placeholder="Ex: 30.0"><span class="alarm-grid-label">Umidade (%)</span><input type="number" step="1" id="alarmeMinUmid" value="${device.alarmeMin?.umidade || ''}" placeholder="Ex: 40"><input type="number" step="1" id="alarmeMaxUmid" value="${device.alarmeMax?.umidade || ''}" placeholder="Ex: 60"></div></div></div>

            <hr><h4>Ativação de Alarmes</h4>
            <div class="form-group"><label>Ativar Alarmes por Sensor</label><div style="display: flex; flex-direction: column; gap: 10px;"><div style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="alarmeSondaAtivo" style="width: auto;" ${isAlarmeSondaAtivo ? 'checked' : ''} ${isSondaAtiva ? '' : 'disabled'}><label for="alarmeSondaAtivo" style="margin-bottom: 0; font-weight: normal; cursor: pointer;">Alarme para Sonda (Ativo apenas se Sonda estiver Ativa)</label></div><div style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="alarmeTempAmbienteAtivo" style="width: auto;" ${isAlarmeTempAmbienteAtivo ? 'checked' : ''}><label for="alarmeTempAmbienteAtivo" style="margin-bottom: 0; font-weight: normal; cursor: pointer;">Alarme para Temperatura Ambiente</label></div><div style="display: flex; align-items: center; gap: 10px;"><input type="checkbox" id="alarmeUmidadeAtivo" style="width: auto;" ${isAlarmeUmidadeAtivo ? 'checked' : ''}><label for="alarmeUmidadeAtivo" style="margin-bottom: 0; font-weight: normal; cursor: pointer;">Alarme para Umidade</label></div></div></div>

            <div class="form-actions"><button type="button" class="admin-button-cancel">Cancelar</button><button type="submit" class="admin-button-save">Salvar</button></div>
        </form>
    `;
    
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    
    const instSelect = document.getElementById('select-inst');
    const unitSelect = document.getElementById('select-unit');
    const setorSelect = document.getElementById('select-setor');

    instSelect.innerHTML = '<option value="">Selecione...</option>';
    (currentUserLevel === 'superAdmin' ? hierarchyCache.instituicoes : hierarchyCache.instituicoes.filter(inst => currentUserInstitutions.includes(inst.id))).forEach(inst => {
        instSelect.innerHTML += `<option value="${inst.id}">${inst.nome || inst.id}</option>`;
    });

    instSelect.addEventListener('change', () => {
        const id = instSelect.value;
        unitSelect.innerHTML = '<option value="">Selecione...</option>';
        setorSelect.innerHTML = '<option value="">Selecione...</option>';
        if (id) hierarchyCache.unidades.filter(u => u.instituicaoId === id).forEach(u => unitSelect.innerHTML += `<option value="${u.id}">${u.nome || u.id}</option>`);
    });

    unitSelect.addEventListener('change', () => {
        const id = unitSelect.value;
        setorSelect.innerHTML = '<option value="">Selecione...</option>';
        if (id) hierarchyCache.setores.filter(s => s.unidadeId === id).forEach(s => setorSelect.innerHTML += `<option value="${s.id}">${s.nome || s.id}</option>`);
    });

    if (deviceId && device.instituicaoID) {
        instSelect.value = device.instituicaoID;
        instSelect.dispatchEvent(new Event('change'));
        setTimeout(() => { if (device.unidadeID) { unitSelect.value = device.unidadeID; unitSelect.dispatchEvent(new Event('change')); } }, 100);
        setTimeout(() => { if (device.setorID) setorSelect.value = device.setorID; }, 200);
    }

    const sondaAtivaCheckbox = document.getElementById('sondaAtiva');
    const alarmeSondaAtivoCheckbox = document.getElementById('alarmeSondaAtivo');
    sondaAtivaCheckbox.addEventListener('change', () => {
        alarmeSondaAtivoCheckbox.disabled = !sondaAtivaCheckbox.checked;
        if (!sondaAtivaCheckbox.checked) alarmeSondaAtivoCheckbox.checked = false;
        else if (!deviceId) alarmeSondaAtivoCheckbox.checked = true;
    });

    modalOverlay.querySelector('.admin-button-cancel').addEventListener('click', () => document.body.removeChild(modalOverlay));
    modalOverlay.querySelector('#device-form').addEventListener('submit', e => { e.preventDefault(); saveDevice(deviceId); });
}

async function saveDevice(deviceId) {
    const isNew = !deviceId;
    const mac = document.getElementById('mac').value.trim();
    if (!mac) return alert("O MAC Address (ID) é obrigatório.");
    
    const finalDeviceId = isNew ? mac : deviceId;
    
    const instSelect = document.getElementById('select-inst');
    const unitSelect = document.getElementById('select-unit');
    const setorSelect = document.getElementById('select-setor');
    
    const deviceData = {
        nomeDispositivo: document.getElementById('nomeDispositivo').value,
        sondaAtiva: document.getElementById('sondaAtiva').checked,
        alarmeSondaAtivo: document.getElementById('alarmeSondaAtivo').checked,
        alarmeTempAmbienteAtivo: document.getElementById('alarmeTempAmbienteAtivo').checked,
        alarmeUmidadeAtivo: document.getElementById('alarmeUmidadeAtivo').checked,
        
        instituicaoID: instSelect.value,
        unidadeID: unitSelect.value,
        setorID: setorSelect.value,
        nomeInstituicao: instSelect.options[instSelect.selectedIndex]?.text || '',
        nomeUnidade: unitSelect.options[unitSelect.selectedIndex]?.text || '',
        nomeSetor: setorSelect.options[setorSelect.selectedIndex]?.text || '',
        
        alarmeMin: {
            sonda: parseFloat(document.getElementById('alarmeMin').value) || null,
            temperaturaAmbiente: parseFloat(document.getElementById('alarmeMinAmb').value) || null,
            umidade: parseFloat(document.getElementById('alarmeMinUmid').value) || null
        },
        alarmeMax: {
            sonda: parseFloat(document.getElementById('alarmeMax').value) || null,
            temperaturaAmbiente: parseFloat(document.getElementById('alarmeMaxAmb').value) || null,
            umidade: parseFloat(document.getElementById('alarmeMaxUmid').value) || null
        }
    };

    try {
        const docRef = doc(db, "dispositivos", finalDeviceId);
        
        if (isNew) {
            deviceData.statusTimestamp = Timestamp.now();
            deviceData.ultimasLeituras = {};
            await setDoc(docRef, deviceData);
            alert("Dispositivo criado com sucesso!");
        } else {
            await setDoc(docRef, deviceData, { merge: true });
            await updateDoc(docRef, { forceReset: true });
            alert("Dispositivo atualizado com sucesso! O dispositivo será reiniciado.");
        }
        
        document.body.removeChild(document.querySelector('.admin-modal-overlay'));
        showDispositivosView();
        
    } catch (error) {
        console.error("Erro ao salvar dispositivo:", error);
        alert(`Erro ao salvar: ${error.message}`);
    }
}

async function deleteDevice(deviceId) {
    if (currentUserLevel !== 'superAdmin') return alert("Acesso negado.");
    
    try {
        await deleteDoc(doc(db, "dispositivos", deviceId));
        alert("Dispositivo excluído com sucesso.");
        showDispositivosView();
    } catch (error) {
        console.error("Erro ao excluir dispositivo:", error);
        alert(`Erro ao excluir: ${error.message}`);
    }
}