// Importações do Firebase SDK v9.x Modular
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, startAt, Timestamp, documentId } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { showNotification } from './utils/notifications.js';

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAawMA2HjEgBZ5gYIawMYECTp0oN4hj6YE",
    authDomain: "temptracker-eb582.firebaseapp.com",
    projectId: "temptracker-eb582",
    storageBucket: "temptracker-eb582.firebasestorage.app",
    messagingSenderId: "1079337208340",
    appId: "1:1079337208340:web:0b86faa43e141f0ff1b501"
};

// Inicializando o Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
console.log("Firebase inicializado com sucesso.");  

// Variáveis globais
let currentChart = null;
let currentDeviceMac = null;

const allDevicesConfig = {}; 
const deviceCards = {};
const deviceListeners = {};
const alarmListeners = {};
const lastValidReadings = {};
const deviceStatus = {};
const deviceAlarmStatus = {}; // MODIFICADO: Irá armazenar o objeto de alarme completo
const activeAlarms = new Set(); 

const OFFLINE_THRESHOLD_SECONDS = 120; 
let statusCheckInterval;

const hierarchyCache = {
    instituicoes: {},
    unidades: {},
    setores: {}
    };


onAuthStateChanged(auth, (user) => {
    if (!user) {
        cleanupBeforeUnload();
        window.location.href = "login.html";
        console.warn("Usuário não autenticado. Redirecionando para login.");  // Log melhorado
    } else {
        console.log(`Usuário autenticado com sucesso: UID ${user.uid}`);  // Log melhorado
        showNotification("Login realizado com sucesso!", 'success', 'Bem-vindo', 3000);  // Nova: Notificação de sucesso
        loadUserData(user.uid); 
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        statusCheckInterval = setInterval(checkAllDeviceStatus, 30000); 
    }
});

/**
 * Carrega os dados do usuário e define as permissões
 */
async function loadUserData(userId) {
    try {
        const userDocRef = doc(db, "usuarios", userId);
        const snapshot = await getDoc(userDocRef);

        if (snapshot.exists()) {
            const userData = snapshot.data();
            console.log("Dados do usuário carregados com sucesso:", userData);
            const userName = userData?.nome || "Usuário";
            document.getElementById("user-name").textContent = userName;
            
            const userSectors = userData.acessoSetores || [];
            const userLevel = userData.nivel || "user";

            const settingsButton = document.querySelector(".config-button");
            const logoutButton = document.querySelector("#logout-button");
            if (userLevel === 'admin' || userLevel === 'superAdmin') {
                if (settingsButton) settingsButton.style.display = 'block';
            } else {
                if (settingsButton) settingsButton.style.display = 'none';
            }
if (logoutButton) {
    logoutButton.style.display = 'block';

    logoutButton.addEventListener("click", (e) => {
        e.preventDefault();

        showCustomConfirm(
            "Sair da conta?",
            "Você será desconectado agora.",
            () => {
                cleanupBeforeUnload();
                signOut(auth).then(() => {
                    window.location.href = "login.html";
                }).catch((error) => {
                    console.error("Erro ao fazer logout:", error);
                    showNotification("Falha ao sair. Tente novamente.", "error", "Erro de Logout", 0);
                });
            }
        );
    });
} else {
    console.warn("Elemento #logout-button não encontrado.");
}




            if (userLevel === 'superAdmin') {
                console.warn("Usuário é superAdmin. Carregando TODOS os setores...");
                const allSectorsSnapshot = await getDocs(collection(db, "setores"));
                const allSectorIds = allSectorsSnapshot.docs.map(doc => doc.id);
                loadPermittedData(allSectorIds);
            } else if (userSectors.length > 0) {
                console.log("Carregando setores permitidos:", userSectors);
                loadPermittedData(userSectors);
            } else {
                console.warn("Nenhum setor encontrado para o usuário:", userId);
                document.getElementById("filters").innerHTML = "<p>Nenhum setor disponível.</p>";
            }
        } else {
            console.warn("Dados do usuário não encontrados para UID:", userId);
            // Usa a função importada
            showNotification("Perfil não encontrado. Você será desconectado.", 'error', 'Erro de Perfil', 0);
            setTimeout(() => auth.signOut(), 3000); 
        }
    } catch (error) {
        console.error("Erro ao carregar dados do usuário:", error);
        // Usa a função importADA
        showNotification("Falha ao carregar perfil. Desconectando...", 'error', 'Erro de Acesso', 0);
        setTimeout(() => auth.signOut(), 3000);
    }
}

/**
 * Carrega todos os dados permitidos com base nos IDs dos setores
 */
async function loadPermittedData(sectorIds) {
    const filtersDiv = document.getElementById("filters");
    filtersDiv.innerHTML = "";
    
    const validSectorIds = sectorIds.filter(id => id && typeof id === 'string');
    if (validSectorIds.length === 0) {
        filtersDiv.innerHTML = "<p>Nenhum setor válido atribuído.</p>";
        return;
    }
    
    detachAllFirebaseListeners();

    try {
        // 1. Buscar os documentos dos setores permitidos
        let sectorPromises = [];
        for (let i = 0; i < validSectorIds.length; i += 30) {
            const chunk = validSectorIds.slice(i, i + 30);
            const sectorsQuery = query(collection(db, "setores"), where(documentId(), "in", chunk));
            sectorPromises.push(getDocs(sectorsQuery));
        }
        const sectorSnapshots = await Promise.all(sectorPromises);
        let sectorData = [];
        sectorSnapshots.forEach(snapshot => {
            snapshot.docs.forEach(d => sectorData.push({ id: d.id, ...d.data() }));
        });
        
        hierarchyCache.setores = {};
        sectorData.forEach(s => hierarchyCache.setores[s.id] = s.nome);

        // 2. Coletar IDs de Unidades e Instituições
        const unitIds = [...new Set(sectorData.map(s => s.unidadeId))].filter(id => id);
        const instIds = [...new Set(sectorData.map(s => s.instituicaoId))].filter(id => id);

        // 3. Buscar os documentos de Unidades e Instituições
        hierarchyCache.unidades = {};
        if (unitIds.length > 0) {
            let unitPromises = [];
            for (let i = 0; i < unitIds.length; i += 30) {
                const chunk = unitIds.slice(i, i + 30);
                const unitsQuery = query(collection(db, "unidades"), where(documentId(), "in", chunk));
                unitPromises.push(getDocs(unitsQuery));
            }
            const unitSnapshots = await Promise.all(unitPromises);
            unitSnapshots.forEach(s => s.docs.forEach(d => hierarchyCache.unidades[d.id] = d.data().nome));
        }
        
        hierarchyCache.instituicoes = {};
        if (instIds.length > 0) {
            let instPromises = [];
            for (let i = 0; i < instIds.length; i += 30) {
                const chunk = instIds.slice(i, i + 30);
                const instsQuery = query(collection(db, "instituicoes"), where(documentId(), "in", chunk));
                instPromises.push(getDocs(instsQuery));
            }
            const instSnapshots = await Promise.all(instPromises);
            instSnapshots.forEach(s => s.docs.forEach(d => hierarchyCache.instituicoes[d.id] = d.data().nome));
        }

        // 4. Buscar os dispositivos que pertencem a esses setores
        let devicePromises = [];
        for (let i = 0; i < validSectorIds.length; i += 30) {
            const chunk = validSectorIds.slice(i, i + 30);
            const devicesQuery = query(collection(db, "dispositivos"), where("setorID", "in", chunk));
            devicePromises.push(getDocs(devicesQuery));
        }
        const deviceSnapshots = await Promise.all(devicePromises);
        let deviceDocs = [];
        deviceSnapshots.forEach(snapshot => deviceDocs.push(...snapshot.docs));


        if (deviceDocs.length === 0) {
            filtersDiv.innerHTML = "<p>Nenhum dispositivo encontrado.</p>";
            return;
        }

        // 5. Processar dispositivos e agrupar para a UI
        const uiTree = {}; 
        Object.keys(allDevicesConfig).forEach(mac => delete allDevicesConfig[mac]);
        
        deviceDocs.forEach(doc => {
            const device = doc.data();
            const mac = doc.id;
            allDevicesConfig[mac] = { mac, ...device };
            const instID = device.instituicaoID;
            const unitID = device.unidadeID;
            const sectorID = device.setorID;
            if (!hierarchyCache.instituicoes[instID] || !hierarchyCache.unidades[unitID] || !hierarchyCache.setores[sectorID]) {
                console.warn(`Dispositivo ${mac} tem hierarquia inválida ou incompleta. Pulando.`);
                return; 
            }
            const instName = hierarchyCache.instituicoes[instID];
            const unitName = hierarchyCache.unidades[unitID];
            const sectorName = hierarchyCache.setores[sectorID];
            if (!uiTree[instID]) uiTree[instID] = { name: instName, units: {} };
            if (!uiTree[instID].units[unitID]) uiTree[instID].units[unitID] = { name: unitName, sectors: {} };
            if (!uiTree[instID].units[unitID].sectors[sectorID]) uiTree[instID].units[unitID].sectors[sectorID] = { name: sectorName, devices: [] };
            uiTree[instID].units[unitID].sectors[sectorID].devices.push(allDevicesConfig[mac]);
        });
        
        // 6. Renderizar o menu de filtros
        renderFilterMenu(uiTree);

        // 7. Adicionar listeners e mostrar os cards
        document.querySelectorAll(".sector-checkbox").forEach(checkbox => {
            checkbox.addEventListener("change", updateDeviceDisplay);
        });
        updateDeviceDisplay(); 

    } catch (error) {
        console.error("Erro ao carregar dados permitidos:", error);
        // Usa a função importada
        showNotification(error.message, 'error', 'Erro ao Carregar Dados');
        filtersDiv.innerHTML = "<p>Erro ao carregar dados.</p>";
    }
}

/**
 * Renderiza o menu lateral de filtros
 */
function renderFilterMenu(uiTree) {
    const filtersDiv = document.getElementById("filters");
    filtersDiv.innerHTML = ""; 

    for (const instID in uiTree) {
        const inst = uiTree[instID];
        const instContainer = document.createElement("div");
        instContainer.className = "institution-container";
        
        instContainer.innerHTML = `
            <div class="institution-header">
                <h4 class="institution-name-label">${inst.name}</h4>
                <span class="change-inst-icon" title="Trocar Instituição">⮂</span>
            </div>
        `;
        
       instContainer.querySelector('.change-inst-icon').addEventListener('click', () => {
    showCustomConfirm(
        "Trocar de instituição?",
        "Você será redirecionado para a tela de login.",
        () => {
            localStorage.removeItem('selectedInstitutionId');
            auth.signOut();
        }
    );
});

        for (const unitID in inst.units) {
            const unit = inst.units[unitID];
            for (const sectorID in unit.sectors) {
                const sector = unit.sectors[sectorID];
                const sectorContainer = document.createElement("div");
                sectorContainer.className = "sector-container";
                const label = document.createElement("label");
                label.className = "sector-label";
                label.innerHTML = `
                    <input type="checkbox" class="sector-checkbox" value="${sectorID}" checked>
                    ${sector.name}
                `;
                sectorContainer.appendChild(label);
                const deviceList = document.createElement("ul");
                deviceList.className = "device-list";
                sector.devices.forEach(device => {
                    const deviceItem = document.createElement("li");
                    deviceItem.textContent = device.nomeDispositivo || 'Dispositivo sem nome';
                    deviceItem.setAttribute('data-mac', device.mac);
                    deviceItem.onclick = () => openDeviceDetails(device.mac);
                    deviceList.appendChild(deviceItem);
                });
                sectorContainer.appendChild(deviceList);
                instContainer.appendChild(sectorContainer);
            }
        }
        filtersDiv.appendChild(instContainer);
    }
}


/**
 * Mostra ou esconde cards com base nos checkboxes de setor
 */
function updateDeviceDisplay() {
    console.log("Chamado: updateDeviceDisplay()");
    const selectedSectorIDs = Array.from(document.querySelectorAll(".sector-checkbox:checked"))
        .map(checkbox => checkbox.value);
    console.log("Setores selecionados (por ID):", selectedSectorIDs);

    for (let mac in allDevicesConfig) {
        const deviceConfig = allDevicesConfig[mac];
        const deviceSetorID = deviceConfig.setorID;
        let cardElement = deviceCards[mac];

        if (selectedSectorIDs.includes(deviceSetorID)) {
            if (!cardElement) {
                console.log(`Criando card para MAC: ${mac}, Setor: ${deviceSetorID}`);
                cardElement = createOrUpdateDeviceCard(mac, deviceConfig);
            }
            if(cardElement) cardElement.style.display = 'flex';
        } else {
            if (cardElement) {
                console.log(`Ocultando card para MAC: ${mac}, Setor: ${deviceSetorID}`);
                cardElement.style.display = 'none';
            }
        }
    }
    for (let mac in deviceCards) {
        if (!allDevicesConfig[mac]) {
            deviceCards[mac].remove();
            delete deviceCards[mac];
        }
    }
}

/**
 * Cria um novo card de dispositivo e inicia o listener (onSnapshot)
 */
function createOrUpdateDeviceCard(mac, deviceConfig) {
    let card = deviceCards[mac];
    if (!card) {
        console.log(`Iniciando criação de card e listeners para MAC: ${mac}`);
        const container = document.getElementById("chartContainer");
        card = document.createElement("div");
        card.className = "device-container";
        card.setAttribute("data-mac", mac);
        container.appendChild(card);
        deviceCards[mac] = card; 
        card.addEventListener("click", () => openDatalogger(mac, allDevicesConfig[mac].nomeDispositivo));
        deviceStatus[mac] = 'OFFLINE';
        // MODIFICADO: Inicializa o status do alarme com um objeto padrão
        deviceAlarmStatus[mac] = { ativo: false, tipo: 'Nenhum' };
        
        // Listener para dados do dispositivo
        const docRef = doc(db, "dispositivos", mac);
        deviceListeners[mac] = onSnapshot(docRef, (doc) => {
            if (doc.exists()) {
                const deviceData = doc.data();
                allDevicesConfig[mac] = { ...allDevicesConfig[mac], ...deviceData };
                const latestReading = deviceData.ultimasLeituras;
                if (latestReading && latestReading.temperatura !== undefined && latestReading.temperatura !== -100.00) {
                    lastValidReadings[mac] = latestReading; 
                }
                checkDeviceStatus(mac); 
                updateCardContent(card, mac);
            } else {
                console.warn(`[Firestore:onSnapshot] Documento para ${mac} não existe mais.`);
                cleanupDevice(mac);
            }
        }, (error) => {
            console.error(`[Firestore:onSnapshot] Erro na escuta para ${mac}:`, error);
        });

       const alarmStatusRef = doc(db, "dispositivos", mac, "eventos", "estadoAlarmeAtual");
        alarmListeners[mac] = onSnapshot(alarmStatusRef, (docSnap) => {
            
            // ########## ESTA É A LINHA CORRIGIDA ##########
            // Lendo o campo 'estadoAlarmeAtual' DENTRO do documento 'estadoAlarmeAtual'
            const alarmData = (docSnap.exists() && docSnap.data().estadoAlarmeAtual) 
                ? docSnap.data().estadoAlarmeAtual 
                : { ativo: false, tipo: "Nenhum" };
            // ###############################################
            
            deviceAlarmStatus[mac] = alarmData; // Armazena o objeto de alarme completo
            
            const isNowActive = alarmData.ativo === true;
            const wasActive = activeAlarms.has(mac);

            // Atualiza notificações apenas se o dispositivo está ONLINE
            if (deviceStatus[mac] === 'ONLINE') {
                // Se o alarme acabou de ficar ATIVO
                if (isNowActive && !wasActive) {
                    const deviceConfig = allDevicesConfig[mac];
                    // Verifica se o alarme é para um sensor habilitado pelo usuário
                    if (deviceConfig && hasActiveAlarmWithEnabledSensors(deviceConfig, alarmData)) {
                        activeAlarms.add(mac);
                        // NOVA MENSAGEM: Usa a função auxiliar para detalhar o alarme
                        const friendlyMessage = getFriendlyAlarmMessage(alarmData.tipo);
                        showNotification(
                            `Dispositivo "${deviceConfig.nomeDispositivo}" em alarme! (${friendlyMessage})`, 
                            'error', 
                            'Alerta de Alarme'
                        );
                    }
                // Se o alarme acabou de ficar INATIVO
                } else if (!isNowActive && wasActive) {
                    activeAlarms.delete(mac);
                }
            } else if (!isNowActive) {
                // Garante que alarmes sejam removidos se o dispositivo estiver offline e o alarme não estiver ativo
                activeAlarms.delete(mac);
            }
            
            updateCardContent(card, mac);

        }, (error) => {
            console.error(`[Firestore:onSnapshot] Erro no listener de alarme para ${mac}:`, error);
            deviceAlarmStatus[mac] = { ativo: false, tipo: 'Nenhum' }; // Reseta em caso de erro
            activeAlarms.delete(mac);
            updateCardContent(card, mac);
        });
    }


    card.style.display = 'flex';
    updateCardContent(card, mac); 
    return card;
}

/**
 * NOVO: Converte o tipo de alarme em uma mensagem legível
 */
function getFriendlyAlarmMessage(tipo) {
    if (!tipo) return "Tipo desconhecido";
    switch (tipo) {
        case 'sonda_min': return "Sonda (Mínima)";
        case 'sonda_max': return "Sonda (Máxima)";
        case 'temperaturaAmbiente_min': return "Ambiente (Mínima)";
        case 'temperaturaAmbiente_max': return "Ambiente (Máxima)";
        case 'umidade_min': return "Umidade (Mínima)";
        case 'umidade_max': return "Umidade (Máxima)";
        case 'falha_sonda': return "Falha de Sonda";
        case 'Nenhum': return "Nenhum";
        default: return tipo; // Retorna o tipo original se não for mapeado
    }
}


/**
 * Verifica se o alarme ativo tem sensores habilitados
 * (Esta função permanece relevante para evitar notificações de sensores desabilitados)
 */
function hasActiveAlarmWithEnabledSensors(deviceConfig, alarmData) {
    if (!deviceConfig || !alarmData) return false;
    
    const alarmType = alarmData.tipo || '';
    const isSondaAtiva = deviceConfig.sondaAtiva === true;
    
    // Verifica quais sensores estão habilitados para alarme
    const alarmeSondaAtivo = deviceConfig.alarmeSondaAtivo === true;
    const alarmeTempAmbienteAtivo = deviceConfig.alarmeTempAmbienteAtivo === true;
    const alarmeUmidadeAtivo = deviceConfig.alarmeUmidadeAtivo === true;
    const alarmeFalhaSondaAtivo = deviceConfig.alarmeFalhaSondaAtivo === true;
    
    // Verifica se o tipo de alarme atual corresponde a algum sensor habilitado
    switch (alarmType) {
        case 'sonda_min':
        case 'sonda_max':
            return alarmeSondaAtivo && isSondaAtiva;
            
        case 'temperaturaAmbiente_min':
        case 'temperaturaAmbiente_max':
            return alarmeTempAmbienteAtivo;
            
        case 'umidade_min':
        case 'umidade_max':
            return alarmeUmidadeAtivo;
            
        case 'falha_sonda':
            return alarmeFalhaSondaAtivo && isSondaAtiva;
            
        default:
            // Para tipos desconhecidos ou múltiplos, considera ativo se algum sensor habilitado está em alarme
            // (Assumindo que 'tipo' pode ser algo como 'multiplo' no futuro)
            return alarmeSondaAtivo || alarmeTempAmbienteAtivo || alarmeUmidadeAtivo || alarmeFalhaSondaAtivo;
    }
}


/**
 * Verifica se um dispositivo está ONLINE ou OFFLINE
 */
function checkDeviceStatus(mac) {
    const config = allDevicesConfig[mac];
    const statusTimestamp = config?.statusTimestamp; 
    if (!config || !statusTimestamp) {
        deviceStatus[mac] = 'OFFLINE';
        return;
    }
    try {
        const nowMillis = Date.now();
        const statusTimestampMillis = statusTimestamp.toMillis(); 
        const differenceMillis = nowMillis - statusTimestampMillis;
        if (differenceMillis > (OFFLINE_THRESHOLD_SECONDS * 1000)) {
            deviceStatus[mac] = 'OFFLINE';
        } else {
            deviceStatus[mac] = 'ONLINE';
        }
        if (deviceCards[mac] && deviceCards[mac].style.display !== 'none') {
            updateCardContent(deviceCards[mac], mac);
        }
    } catch (e) {
        console.warn(`Erro ao verificar status do MAC ${mac} (timestamp inválido?)`, e);
        deviceStatus[mac] = 'OFFLINE';
    }
}

/**
 * Executa 'checkDeviceStatus' para todos os dispositivos
 */
function checkAllDeviceStatus() {
    console.log("Executando verificação periódica de status...");
    for (const mac in allDevicesConfig) {
        checkDeviceStatus(mac);
    }
}

/**
 * Atualiza o conteúdo do card (MODIFICADO para nova lógica de alarme)
 */
function updateCardContent(cardElement, mac) {
    const deviceConfig = allDevicesConfig[mac];
    const currentReading = deviceConfig.ultimasLeituras;
    const status = deviceStatus[mac] || 'OFFLINE'; 
    
    // MODIFICADO: Obtém o estado de alarme do listener
    const alarmState = deviceAlarmStatus[mac] || { ativo: false, tipo: 'Nenhum' };
    const isAlarm = alarmState.ativo === true;

    // MODIFICADO: Adiciona/Remove a classe 'in-alarm' para o fundo do card
    // Isso deve ser feito ANTES do innerHTML para garantir que o elemento exista
    if (cardElement) {
        cardElement.classList.toggle('in-alarm', isAlarm);
    }

    const isSondaAtiva = deviceConfig.sondaAtiva === true;

    let mainValue = "N/A";
    let ambientTempValue = "N/A";
    let humidityValue = "N/A";
    let timestampText = "Sem dados";
    // MODIFICADO: Cor principal agora é sempre padrão, não mais vermelha em alarme
    let mainColor = "#000000"; 
    let alarmeMinDisplay = 'N/A';
    let alarmeMaxDisplay = 'N/A';
    
    // Textos com ícones
    let mainLabelText = isSondaAtiva ? "🌡️ Sonda Externa" : "🏠 Temperatura Ambiente";

    if (status === 'ONLINE' && currentReading && typeof currentReading === 'object') {
        const tempSonda = currentReading.temperatura;
        const tempAmb = currentReading.temperaturaAmbiente;
        const umidade = currentReading.umidade;

        if (tempAmb !== undefined && tempAmb > -50) ambientTempValue = `${tempAmb.toFixed(1)}°C`;
        
        if (umidade !== undefined) humidityValue = `${parseFloat(umidade).toFixed(1)}%`;

        if (isSondaAtiva) {
            const minAlarm = deviceConfig.alarmeMin?.sonda;
            const maxAlarm = deviceConfig.alarmeMax?.sonda;
            alarmeMinDisplay = minAlarm !== undefined ? `${minAlarm}°C` : 'N/A';
            alarmeMaxDisplay = maxAlarm !== undefined ? `${maxAlarm}°C` : 'N/A';

            if (tempSonda !== undefined) {
                // MODIFICADO: Lógica de 'isAlarm = true' removida daqui
                if (tempSonda <= -100) { // Falha (-100, -127, etc.)
                    mainValue = "N/A";
                } 
                else { // Leitura normal ou em alarme (apenas exibe o valor)
                    mainValue = `${tempSonda.toFixed(1)}°C`;
                }
            }
            // (tempSonda === undefined) -> mainValue continua "N/A"
            
       } else {
            // MODO AMBIENTE
            
            // --- 1. Lógica da Temperatura Ambiente (Valor Principal) ---
            const minAlarmAmb = deviceConfig.alarmeMin?.temperaturaAmbiente;
            const maxAlarmAmb = deviceConfig.alarmeMax?.temperaturaAmbiente;
            alarmeMinDisplay = minAlarmAmb !== undefined ? `${minAlarmAmb}°C` : 'N/A';
            alarmeMaxDisplay = maxAlarmAmb !== undefined ? `${maxAlarmAmb}°C` : 'N/A';

            if (tempAmb !== undefined) {
                // MODIFICADO: Lógica de 'isAlarm = true' removida daqui
                if (tempAmb <= -100) {
                    mainValue = "N/A";
                }
                else {
                    mainValue = `${tempAmb.toFixed(1)}°C`;
                }
            }
            
            // --- 2. Lógica da Umidade (Valor Secundário) ---
            const minAlarmUmid = deviceConfig.alarmeMin?.umidade;
            const maxAlarmUmid = deviceConfig.alarmeMax?.umidade;

            if (umidade !== undefined) {
                // MODIFICADO: Lógica de 'isAlarm = true' removida daqui
                if (umidade < 0) { // Falha (ESP32 envia -1.0)
                    humidityValue = "N/A";
                }
                else {
                    humidityValue = `${parseFloat(umidade).toFixed(1)}%`;
                }
            }
        }

        // MODIFICADO: 'mainColor' não é mais condicional ao alarme
        // mainColor = isAlarm ? "#e74c3c" : "#000000"; // LINHA REMOVIDA

        const timestamp = currentReading.timestamp;
        if (timestamp && typeof timestamp.toDate === 'function') {
            const date = timestamp.toDate(); 
            timestampText = `Última leitura: ${date.toLocaleString("pt-BR")}`;
        }

        // MODIFICADO: Bloco de notificação redundante REMOVIDO
        /* if (isAlarm) {
            if (!activeAlarms.has(mac)) {
                activeAlarms.add(mac);
                showNotification(`O dispositivo "${deviceConfig.nomeDispositivo}" está fora dos limites!`, 'error', 'Alerta de Alarme');
            }
        } else {
            activeAlarms.delete(mac);
        }
        */

    } else {
        mainColor = "#95a5a6"; // Cor cinza para offline
        // activeAlarms.delete(mac); // Já é tratado pelo listener de alarme
        if (currentReading && currentReading.timestamp && typeof currentReading.timestamp.toDate === 'function') {
             const date = currentReading.timestamp.toDate(); 
             timestampText = `Última leitura: ${date.toLocaleString("pt-BR")}`;
        }
    }
    
    const setorDisplay = deviceConfig.nomeSetor || 'N/A';
    const nomeDispositivoDisplay = deviceConfig.nomeDispositivo || 'Dispositivo Desconhecido';

    // NOVO: HTML diferenciado para modo sonda vs ambiente
    const additionalDataHTML = isSondaAtiva 
        ? `
            <div class="additional-data">
                <div class="data-item">
                    <div class="data-label">Temp. Ambiente</div>
                    <div class="data-value">${ambientTempValue}</div>
                </div>
                <div class="data-item">
                    <div class="data-label">Umidade</div>
                    <div class="data-value">${humidityValue}</div>
                </div>
            </div>
        `
        : `
            <div class="additional-data single-item">
                <div class="data-item">
                    <div class="data-label">Umidade</div>
                    <div class="data-value">${humidityValue}</div>
                </div>
            </div>
        `;

    cardElement.innerHTML = `
        <div class="device-header">${setorDisplay}</div>
        <div class="device-name">${nomeDispositivoDisplay}</div>
        <div class="device-header" style="font-weight: bold; color: ${isSondaAtiva ? 'var(--cor-texto-cinza)' : '#3498db'};">
             ${mainLabelText}
        </div>
        <div class="main-temperature" style="color: ${mainColor}">${mainValue}</div>
        <div class="alarm-info">
            <span style="color: #3498db;">${alarmeMinDisplay}</span>
            &lt; alarmes &gt;
            <span style="color: #e74c3c;">${alarmeMaxDisplay}</span>
        </div>
        ${additionalDataHTML}
        <div class="timestamp">${timestampText}</div>
        <div class="status-badge status-${status.toLowerCase()}">${status}</div>
    `;
}



/**
 * Funções de Alerta (Toast) REMOVIDAS
 */

/**
 * Abre o modal do Datalogger (atualizado com botão de detalhes)
 */
function openDatalogger(mac, deviceName) {
    currentDeviceMac = mac;
    document.getElementById("modal-device-name").textContent = deviceName;
    document.getElementById("datalogger-modal").style.display = "block";
    
    // Configura o botão "Mais Detalhes"
    const detailsBtn = document.getElementById("more-details-btn");
    detailsBtn.onclick = () => {
        window.location.href = `device_details.html?mac=${mac}`;
    };
    
    // Reseta o filtro para 12 horas e carrega dados
    document.getElementById("time-filter").value = "12";
    updateChartData();
    
    console.log(`Abrindo datalogger para ${deviceName} (${mac})`);
}

/**
 * Atualiza o gráfico (Corrigido para nova nomenclatura)
 */
async function updateChartData() {
    if (!currentDeviceMac) return;

    const timeFilterElement = document.getElementById("time-filter");
    const timeFilterValue = timeFilterElement.value;
    const hours = parseInt(timeFilterValue);

    // Calcula timestamps como no device_details.js
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (hours * 3600 * 1000));
    const startTimeStamp = Math.floor(startDate.getTime() / 1000);
    const endTimeStamp = Math.floor(endDate.getTime() / 1000);

    console.log(`Atualizando gráfico para ${currentDeviceMac}. Período: ${hours}h (${startTimeStamp} até ${endTimeStamp})`);

    try {
        // Busca dados igual ao device_details.js
        const dataQuery = query(
            collection(db, "dispositivos", currentDeviceMac, "leituras"),
            where("timestamp", ">=", startTimeStamp),
            where("timestamp", "<=", endTimeStamp),
            orderBy("timestamp")
        );
        
        const snapshot = await getDocs(dataQuery);
        const readings = [];
        snapshot.docs.forEach(doc => {
            readings.push(doc.data());
        });

        // Renderiza o gráfico com os dados
        renderChartModal(readings, hours);

    } catch (error) {
        console.error("Erro ao carregar dados para o gráfico:", error);
        showNotification("Não foi possível carregar o gráfico.", 'error', 'Erro no Gráfico', 0);
    }
}

function renderChartModal(readings, hours) {
    const labels = [];
    const temperatures = [];
    const ambientTemps = [];
    const humidities = [];

    readings.forEach(reading => {
        if (typeof reading.timestamp !== 'number') return; 
        const date = new Date(reading.timestamp * 1000); 
        
        // Formata o label baseado no período (igual ao device_details.js)
        let labelFormat;
        if (hours <= 24) {
            labelFormat = date.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
        } else {
            labelFormat = date.toLocaleString("pt-BR", { 
                day: '2-digit', 
                month: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        }
        
        labels.push(labelFormat);
        temperatures.push(reading.temperatura ?? null);
        ambientTemps.push(reading.temperaturaAmbiente ?? null);
        humidities.push(reading.umidade ?? null);
    });

    const ctx = document.getElementById("device-chart").getContext("2d");
    
    // Destrói gráfico anterior se existir
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    // Cria datasets igual ao device_details.js
    const datasets = [
        { 
            label: "Temperatura Sonda (°C)", 
            data: temperatures, 
            borderColor: "#e74c3c", 
            fill: true, 
            spanGaps: true 
        },
        { 
            label: "Temp. Ambiente (°C)", 
            data: ambientTemps, 
            borderColor: "#3498db", 
            fill: true, 
            spanGaps: true 
        },
        { 
            label: "Umidade (%)", 
            data: humidities, 
            borderColor: "#2ecc71", 
            fill: true, 
            yAxisID: 'y1', 
            spanGaps: true 
        }
    ];

    currentChart = new Chart(ctx, {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    title: { display: true, text: 'Temperatura (°C)' } 
                },
                y1: { 
                    position: 'right', 
                    title: { display: true, text: 'Umidade (%)' }, 
                    grid: { drawOnChartArea: false } 
                },
                x: { 
                    title: { display: true, text: 'Horário' } 
                }
            }
        }
    });
    
    console.log(`Gráfico modal renderizado com ${readings.length} pontos.`);
}


/**
 * Renderiza o gráfico com Chart.js
 */
function renderChart(labels, temperatures, ambientTemps, humidities) {
    const ctx = document.getElementById("device-chart").getContext("2d");
    if (currentChart) {
        currentChart.destroy();
    }
    const datasets = [{
        label: "Temperatura Sonda (°C)",
        data: temperatures,
        borderColor: "var(--cor-alarme-vermelho)",
        backgroundColor: "rgba(231, 76, 60, 0.1)",
        borderWidth: 2,
        tension: 0.1,
        fill: true,
        spanGaps: true
    }];
    if (ambientTemps.length > 0 && ambientTemps.some(t => t !== null)) {
        datasets.push({
            label: "Temp. Ambiente (°C)",
            data: ambientTemps,
            borderColor: "var(--cor-destaque-azul)",
            backgroundColor: "rgba(52, 152, 219, 0.1)",
            borderWidth: 2,
            tension: 0.1,
            fill: true,
            spanGaps: true
        });
    }
    if (humidities.length > 0 && humidities.some(h => h !== null)) {
        datasets.push({
            label: "Umidade (%)",
            data: humidities,
            borderColor: "var(--cor-online-verde)",
            backgroundColor: "rgba(46, 204, 113, 0.1)",
            borderWidth: 2,
            tension: 0.1,
            fill: true,
            yAxisID: 'y1',
            spanGaps: true
        });
    }
    currentChart = new Chart(ctx, {
        type: "line",
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: false, title: { display: true, text: "Temperatura (°C)" } },
                y1: { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: "Umidade (%)" }, grid: { drawOnChartArea: false } },
                x: { title: { display: true, text: "Horário" } }
            }
        }
    });
    console.log(`Gráfico renderizado para ${labels.length} pontos.`);
}

/**
 * Fecha o modal do Datalogger
 */
function closeDatalogger() {
    document.getElementById("datalogger-modal").style.display = "none";
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
    currentDeviceMac = null;
    console.log("Datalogger fechado.");
}

/**
 * Event Listeners Globais
 */
document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("menu").classList.toggle("collapsed");
    document.getElementById("content").classList.toggle("expanded");
    console.log("Toggle menu.");
});

window.updateChartData = updateChartData; 
window.closeDatalogger = closeDatalogger;

function cleanupBeforeUnload() {
    console.log("Limpando listeners e intervalos...");
    detachAllFirebaseListeners();
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
}

function detachAllFirebaseListeners() {
    console.log(`Desativando ${Object.keys(deviceListeners).length} listeners do Firebase.`);
    for (const mac in deviceListeners) {
        if (deviceListeners[mac]) {
            deviceListeners[mac]();
        }
    }
    for (const mac in deviceListeners) {
        delete deviceListeners[mac];
    }
    // MODIFICADO: Garante que os listeners de alarme também sejam limpos
    for (const mac in alarmListeners) {
        if (alarmListeners[mac]) {
            alarmListeners[mac]();
        }
        delete alarmListeners[mac];
    }
}

function openDeviceDetails(mac) {
    window.location.href = `device_details.html?mac=${mac}`;
}

window.addEventListener('beforeunload', cleanupBeforeUnload);



/**
 * Modal de confirmação personalizado (substitui window.confirm)
 */
function showCustomConfirm(title, message, onConfirm) {
    // Remove modal antigo se existir
    const existing = document.getElementById('custom-confirm-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'custom-confirm-modal';
    modal.className = 'confirmation-modal';
    modal.innerHTML = `
        <div class="confirmation-content">
            <h4>${title}</h4>
            <p>${message}</p>
            <div class="confirmation-buttons">
                <button class="confirmation-btn ok">OK</button>
                <button class="confirmation-btn cancel">Cancelar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Mostra com animação
    requestAnimationFrame(() => modal.classList.add('show'));

    // Botões
    modal.querySelector('.ok').onclick = () => {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
            if (onConfirm) onConfirm();
        }, 200);
    };

    modal.querySelector('.cancel').onclick = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 200);
    };

    // Fechar com ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.querySelector('.cancel').click();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}