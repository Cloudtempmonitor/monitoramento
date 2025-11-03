// Importações 
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { showNotification } from "./utils/notifications.js";

// Config do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAawMA2HjEgBZ5gYIawMYECTp0oN4hj6YE",
  authDomain: "temptracker-eb582.firebaseapp.com",
  projectId: "temptracker-eb582",
  storageBucket: "temptracker-eb582.firebasestorage.app",
  messagingSenderId: "1079337208340",
  appId: "1:1079337208340:web:0b86faa43e141f0ff1b501",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentMac = null;
let currentChart = null;
let currentReadings = [];
let flatpickrInstance = null; 

const OFFLINE_THRESHOLD_SECONDS = 120;
const formatTime = (d) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const formatDate = (d) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
    } else {
        loadUserData(user.uid);
        currentMac = new URLSearchParams(window.location.search).get("mac");
        
        if (!currentMac) {
            showNotification("Dispositivo não especificado.", "error");
            window.location.href = "index.html";
        }

        //INICIA OS LISTENERS EM TEMPO REAL
        listenToDeviceStatus(currentMac);
        listenToAlarmStatus(currentMac);

        //INICIA OS FILTROS (Gráfico e Histórico)
        initializeFilters();
    }
});
function listenToDeviceStatus(mac) {
    const deviceDocRef = doc(db, "dispositivos", mac);

    // Inicia o listener
    onSnapshot(deviceDocRef, (snapshot) => {
        
        // Pega os elementos da UI que serão atualizados
        const statusBox = document.getElementById("realtime-status-box");
        const statusText = document.getElementById("realtime-status-text");
        const statusDetail = document.getElementById("realtime-status-detail");
        const lastReadingEl = document.getElementById("last-reading");
        const lastUpdateEl = document.getElementById("last-update-time");
        const deviceNameEl = document.getElementById("device-name");
        
        const setorEl = document.getElementById("info-setor");
        const unidadeEl = document.getElementById("info-unidade"); 
        
        const configListEl = document.getElementById("info-config-list");

        if (snapshot.exists()) {
            const deviceData = snapshot.data();

            // ATUALIZA NOME E INFO CARD 
            deviceNameEl.textContent = deviceData.nomeDispositivo || "Dispositivo sem nome";
            
            // (Presume que o campo no Firestore se chama 'nomeUnidade')
            unidadeEl.textContent = deviceData.nomeUnidade || "Não definida"; 
            setorEl.textContent = deviceData.nomeSetor || "Não definido";

            configListEl.innerHTML = `
                <li><strong>Intervalo de Envio:</strong> ${(typeof deviceData.intervaloEnvio === 'number') ? (deviceData.intervaloEnvio / 60) + ' min' : 'N/A'}</li>
                <li><strong>Alarme Ambiente:</strong> ${deviceData.alarmeTempAmbienteAtivo ? '✅' : '❌'}</li>
                <li><strong>Sonda Ativa:</strong> ${deviceData.sondaAtiva ? '✅' : '❌'}</li>
                <li><strong>Alarme Sonda:</strong> ${deviceData.alarmeSondaAtivo ? '✅' : '❌'}</li>
                <li><strong>Alarme Umidade:</strong> ${deviceData.alarmeUmidadeAtivo ? '✅' : '❌'}</li>
                <li><strong>Alarme Falha Sonda:</strong> ${deviceData.alarmeFalhaSondaAtivo ? '✅' : '❌'}</li>
                
                
                
            `;

            // ATUALIZA ÚLTIMAS LEITURAS
            const lastReading = deviceData.ultimasLeituras || {};
            const sondaTemp = lastReading.temperatura;
            const ambTemp = lastReading.temperaturaAmbiente;
            const umid = lastReading.umidade;

            lastReadingEl.textContent = `Sonda: ${
                sondaTemp !== undefined ? sondaTemp.toFixed(1) : "N/A"
            }°C | Amb: ${ambTemp !== undefined ? ambTemp.toFixed(1) : "N/A"}°C | Umid: ${
                umid !== undefined ? umid.toFixed(1) : "N/A"
            }%`;

            const lastReadingTimestamp = deviceData.ultimasLeituras?.timestamp;
            if (lastReadingTimestamp && lastReadingTimestamp.toDate) {
                lastUpdateEl.textContent = 
                    `Atualizado em: ${lastReadingTimestamp.toDate().toLocaleString('pt-BR')}`;
            } else {
                lastUpdateEl.textContent = "Nenhuma leitura recente.";
            }

            // ATUALIZA STATUS ONLINE/OFFLINE 
            const statusTimestamp = deviceData.statusTimestamp;
            let status = "OFFLINE";
            if (statusTimestamp && typeof statusTimestamp.toMillis === "function") {
                const nowMillis = Date.now();
                const statusTimestampMillis = statusTimestamp.toMillis();
                const differenceMillis = nowMillis - statusTimestampMillis;
                
                // OFFLINE_THRESHOLD_SECONDS 
                if (differenceMillis <= OFFLINE_THRESHOLD_SECONDS * 1000) {
                    status = "ONLINE";
                }
            }

            // 4. ATUALIZA O PAINEL DE STATUS
            if (status === "ONLINE") {
                if (!statusBox.classList.contains('alarme')) {
                    statusBox.className = "status-box normal";
                    statusText.textContent = "NORMAL";
                    statusDetail.textContent = "Operando dentro dos limites";
                }
            } else {
                statusBox.className = "status-box offline";
                statusText.textContent = "OFFLINE";
                statusDetail.textContent = "Sem comunicação";
            }

        } else {
            // Documento não existe
            showNotification("Dispositivo não encontrado.", "error");
            window.location.href = "index.html";
        }
    }, (error) => {
        console.error("Erro ao ouvir documento do dispositivo: ", error);
        document.getElementById("realtime-status-text").textContent = "ERRO DE CONEXÃO";
        document.getElementById("realtime-status-detail").textContent = "Falha ao carregar dados.";
        document.getElementById("realtime-status-box").className = "status-box offline";
    });
}


function listenToAlarmStatus(mac) {
    const statusBox = document.getElementById("realtime-status-box");
    const statusText = document.getElementById("realtime-status-text");
    const statusDetail = document.getElementById("realtime-status-detail");
    
    const alarmStatusRef = doc(db, "dispositivos", mac, "eventos", "estadoAlarmeAtual");

    onSnapshot(alarmStatusRef, (docSnap) => {
        
        // Se o outro listener já marcou como offline, NÃO FAZ NADA.
        if (statusBox.classList.contains('offline')) {
            return; 
        }

        if (docSnap.exists()) {
            const data = docSnap.data().estadoAlarmeAtual || {};
            
            if (data.ativo === true) {
                // EM ALARME (e Online)
                statusBox.className = "status-box alarme";
                statusText.textContent = "EM ALARME";
                statusDetail.textContent = `Tipo: ${data.tipo || 'Indefinido'}`;
            } else {
                // NORMAL (e Online)
                statusBox.className = "status-box normal";
                statusText.textContent = "NORMAL";
                statusDetail.textContent = "Operando dentro dos limites";
            }
        } else {
            // Se o doc não existe, mas estamos ONLINE, significa status NORMAL.
            statusBox.className = "status-box normal";
            statusText.textContent = "NORMAL";
            statusDetail.textContent = "Operando dentro dos limites";
        }
    }, (error) => {
        console.error("Erro ao ouvir status de alarme: ", error);
        // Não faz nada em caso de erro, deixa o listener principal tratar
    });
}
async function loadUserData(userId) {
  const userDocRef = doc(db, "usuarios", userId);
  const snapshot = await getDoc(userDocRef);
  if (snapshot.exists()) {
    const userData = snapshot.data();
    document.getElementById("user-name").textContent =
      userData.nome || "Usuário";
  }
}

/**
 * Inicializa o flatpickr e os listeners de filtro
 */
function initializeFilters() {
  // Configura o calendário (flatpickr)
  flatpickrInstance = flatpickr("#date-range-picker", {
    mode: "range", // Ativa o modo de período
    enableTime: true, // Permite selecionar hora e minuto
    dateFormat: "d/m/y H:i", // Formato brasileiro
    locale: "pt", // Traduz para português
    defaultHour: 0, // HORA PADRÃO: 00:00 (meia-noite)
    defaultMinute: 0, //MINUTO PADRÃO: 00:00
    // Função chamada QUANDO O USUÁRIO muda a data manualmente
    onChange: function (selectedDates, dateStr, instance) {
      // Se o usuário selecionou um range, marca o dropdown como "custom"
      if (selectedDates.length === 2) {
        document.getElementById("time-filter").value = "custom";
      }
    },
  });

  // 2. Listener para o botão "Atualizar"
  document
    .getElementById("update-button")
    .addEventListener("click", updateChartData);

  // 3. Listener para o dropdown de "Período Rápido"
  document.getElementById("time-filter").addEventListener("change", (e) => {
    setPickerToPreset(e.target.value);
  });

  // 4. Define o período inicial no calendário
  setPickerToPreset("12");

  // 5. Carrega os dados iniciais (das últimas 12h)
  updateChartData();
}

/**
 *Atualiza o calendário flatpickr com base no dropdown
 */
function setPickerToPreset(hoursValue) {
  if (hoursValue === "custom" || !flatpickrInstance) return;

  const hours = parseInt(hoursValue);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - hours * 3600 * 1000);

  // Define programaticamente o período no calendário
  flatpickrInstance.setDate([startDate, endDate]);
}

/**
 * (Controlador) Lê o período do flatpickr e chama o fetchData.
 */
async function updateChartData() {
  if (!currentMac || !flatpickrInstance) return;

  // Lê as datas DIRETAMENTE do calendário
  const selectedDates = flatpickrInstance.selectedDates;

  if (selectedDates.length < 2) {
    showNotification(
      "Por favor, selecione um período válido (data inicial e final).",
      "info"
    );
    return;
  }

  const startDate = selectedDates[0];
  const endDate = selectedDates[1];

  // Converte para segundos (Timestamp Unix)
  const startTimeStamp = Math.floor(startDate.getTime() / 1000);
  const endTimeStamp = Math.floor(endDate.getTime() / 1000);

  if (startTimeStamp > endTimeStamp) {
    showNotification(
      "Data inicial não pode ser posterior à data final.",
      "error"
    );
    return;
  }

  // Chama a função central de busca de dados
  await fetchData(startTimeStamp, endTimeStamp);
}

/**
 * (Fetcher) Busca Eventos de Alarme em alertas.
 */ async function fetchAlarmEvents(startTimeStamp, endTimeStamp) {
  try {
    const eventsQuery = query(
      collection(db, "dispositivos", currentMac, "eventos"),
      where("startTime", ">=", new Date(startTimeStamp * 1000)),
      where("startTime", "<=", new Date(endTimeStamp * 1000)),
      orderBy("startTime")
    );

    const snapshot = await getDocs(eventsQuery);
    const alarmEvents = [];

    snapshot.docs.forEach((doc) => {
      const eventData = doc.data();
      alarmEvents.push({
        id: doc.id,
        ...eventData,
        // Converte de volta para timestamp Unix se necessário
        startTimestamp: eventData.startTime?.toMillis() / 1000,
        endTimestamp: eventData.endTime?.toMillis() / 1000,
      });
    });

    return alarmEvents;
  } catch (error) {
    console.error("Erro ao buscar eventos de alarme:", error);
    return [];
  }
}

/**
 * (Fetcher) Busca os dados no Firestore e delega a renderização.
 */
async function fetchData(startTimeStamp, endTimeStamp) {
  console.log(
    `Buscando dados de ${new Date(startTimeStamp * 1000)} até ${new Date(
      endTimeStamp * 1000
    )}`
  );
  showLoading(true);

  try {
    // 1. Busca LEITURAS para o gráfico
    const dataQuery = query(
      collection(db, "dispositivos", currentMac, "leituras"),
      where("timestamp", ">=", startTimeStamp),
      where("timestamp", "<=", endTimeStamp),
      orderBy("timestamp")
    );
    const snapshot = await getDocs(dataQuery);
    currentReadings = [];
    snapshot.docs.forEach((doc) => {
      currentReadings.push(doc.data());
    });

    // 2. Busca EVENTOS DE ALARME separadamente
    const alarmEvents = await fetchAlarmEvents(startTimeStamp, endTimeStamp);

    // 3. Renderiza tudo
    renderChart(currentReadings);

    const deviceSnap = await getDoc(doc(db, "dispositivos", currentMac));
    const deviceConfig = deviceSnap.exists() ? deviceSnap.data() : {};

    // Passa os eventos de alarme em vez de detectar das leituras
    renderAlarmHistory(alarmEvents, deviceConfig);
    renderStats(currentReadings, deviceConfig);
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
  } finally {
    showLoading(false);
  }
}

function renderChart(readings) {
  const labels = [];
  const temperatures = [];
  const ambientTemps = [];
  const humidities = [];

  readings.forEach((reading) => {
    if (typeof reading.timestamp !== "number") return;
    const date = new Date(reading.timestamp * 1000);
    labels.push(date.toLocaleString("pt-BR"));
    temperatures.push(reading.temperatura ?? null);
    ambientTemps.push(reading.temperaturaAmbiente ?? null);
    humidities.push(reading.umidade ?? null);
  });

  const ctx = document.getElementById("device-chart").getContext("2d");
  if (currentChart) currentChart.destroy();
  const datasets = [
    {
      label: "Temperatura Sonda (°C)",
      data: temperatures,
      borderColor: "#e74c3c",
      fill: true,
      spanGaps: true,
    },
    {
      label: "Temp. Ambiente (°C)",
      data: ambientTemps,
      borderColor: "#3498db",
      fill: true,
      spanGaps: true,
    },
    {
      label: "Umidade (%)",
      data: humidities,
      borderColor: "#2ecc71",
      fill: true,
      yAxisID: "y1",
      spanGaps: true,
    },
  ];
  currentChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { title: { display: true, text: "Temperatura (°C)" } },
        y1: {
          position: "right",
          title: { display: true, text: "Umidade (%)" },
          grid: { drawOnChartArea: false },
        },
        x: { title: { display: true, text: "Horário" } },
      },
    },
  });
}

function renderAlarmHistory(alarmEvents, deviceConfig = {}) {
  const alarmList = document.getElementById("alarm-list");
  alarmList.innerHTML = "";

  if (!alarmEvents || alarmEvents.length === 0) {
    alarmList.innerHTML = `<li style="text-align:center;padding:20px;color:#95a5a6;font-style:italic;">Nenhum alarme no período.</li>`;
    return;
  }

  // Renderiza cada evento
  alarmEvents.forEach((event) => {
    const li = document.createElement("li");

    const startDate = new Date(event.startTimestamp * 1000);
    const endDate = event.endTimestamp
      ? new Date(event.endTimestamp * 1000)
      : null;

    const startStr = `${formatDate(startDate)} ${formatTime(startDate)}`;
    const endStr = endDate
      ? `${formatDate(endDate)} ${formatTime(endDate)}`
      : "ATIVO";

    // Duração
    let duracao = "Em andamento";
    if (endDate) {
      const diff = Math.round((endDate - startDate) / 60000);
      duracao =
        diff < 60 ? `${diff} min` : `${Math.floor(diff / 60)}h ${diff % 60}m`;
    }

    // Leituras do início do evento
    const startReading = event.startReading || {};
    const sonda = formatValue(
      startReading.temperatura,
      "sonda",
      "°C",
      deviceConfig
    );
    const amb = formatValue(
      startReading.temperaturaAmbiente,
      "temperaturaAmbiente",
      "°C",
      deviceConfig
    );
    const umid = formatValue(
      startReading.umidade,
      "umidade",
      "%",
      deviceConfig
    );

    const status = event.status === "resolvido" ? "resolvido" : "ativo";
    const statusText = event.status === "resolvido" ? "RESOLVIDO" : "ATIVO";
    const icon = event.status === "resolvido" ? "✅" : "⚠️";

    li.innerHTML = `
            <span class="alarm-icon" style="cursor:pointer;">${icon}</span>
            <span style="flex:1; display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:0.95em;">
                <span>
                    <strong>Início:</strong> ${startStr} → <strong>Fim:</strong> ${endStr}
                    ${
                      duracao !== "Em andamento"
                        ? ` | <strong>Duração:</strong> ${duracao}`
                        : ""
                    }
                </span>
                <span style="color:#2c3e50;">
                    ${sonda ? `Sonda: ${sonda}` : ""}
                    ${amb ? ` · Ambiente: ${amb}` : ""}
                    ${umid ? ` · Umidade: ${umid}` : ""}
                </span>
                <span class="alarm-status ${status}">${statusText}</span>
            </span>
        `;

    const iconSpan = li.querySelector(".alarm-icon");
    iconSpan.addEventListener("click", () => {
      openAlarmGraph(event, deviceConfig);
    });

    alarmList.appendChild(li);
  });
}

// === FUNÇÃO DE FORMATAÇÃO  ===
function formatValue(val, key, unit, config) {
  if (val === null || val === undefined) return "";
  const min = config?.alarmeMin?.[key];
  const max = config?.alarmeMax?.[key];

  let isError = false;
  let limitStr = "";

  if (min !== null && min !== undefined && val < min) {
    isError = true;
    limitStr = ` (Min: ${min.toFixed(1)}${unit})`;
  } else if (max !== null && max !== undefined && val > max) {
    isError = true;
    limitStr = ` (Max: ${max.toFixed(1)}${unit})`;
  }

  const valueStr = `<span class="alarm-value" style="${
    isError ? "color:#e74c3c; font-weight:bold;" : ""
  }">${val.toFixed(1)}${unit}</span>`;
  // Oculta o limite se não for um erro, para não poluir a tela
  const limitHtml = isError
    ? ` <span class="alarm-limit" style="font-size:0.9em; color:#7f8c8d;">${limitStr}</span>`
    : "";

  // Retorna a string SOMENTE se for um erro
  return isError ? valueStr + limitHtml : "";
}

function formatModalTriggerValue(reading, key, label, unit, config) {
  // Pega os valores da leitura e da configuração
  const val = reading?.[key];
  const min = config?.alarmeMin?.[key];
  const max = config?.alarmeMax?.[key];

  let inAlarm = false;
  let valStr = "N/A";

  if (val !== null && val !== undefined) {
    valStr = `${val.toFixed(1)}${unit}`;
    // Verifica se está em alarme
    if (
      (min !== null && min !== undefined && val < min) ||
      (max !== null && max !== undefined && val > max)
    ) {
      inAlarm = true;
    }
  }

  // Formata os limites
  const minStr =
    min !== null && min !== undefined ? `${min.toFixed(1)}${unit}` : "N/A";
  const maxStr =
    max !== null && max !== undefined ? `${max.toFixed(1)}${unit}` : "N/A";

  // Retorna o bloco de HTML
  return `
        <div class="trigger-reading-group">
            <strong>${label}</strong>
            <div class="trigger-details">
                <span class="trigger-value ${
                  inAlarm ? "in-alarm" : ""
                }">${valStr}</span>
                <span class="trigger-limits">
                    Min: ${minStr}<br>
                    Max: ${maxStr}
                </span>
            </div>
        </div>
    `;
}
/**
 *Formata a linha de "Leitura do Disparo"
 */
function formatModalTrigger(key, value, unit, label, config) {
  if (value === null || value === undefined) return "";
  const min = config?.alarmeMin?.[key];
  const max = config?.alarmeMax?.[key];
  let limitStr = "";
  let isError = false;

  // Pedido: Mudar a legenda
  if (min !== undefined && min !== null && value < min) {
    isError = true;
    limitStr = `(Alarme Mín: ${min.toFixed(1)}${unit})`;
  } else if (max !== undefined && max !== null && value > max) {
    isError = true;
    limitStr = `(Alarme Máx: ${max.toFixed(1)}${unit})`;
  }

  if (!isError) return ""; // Só retorna a string se foi este que disparou

  return `
        <div class="trigger-item">
            <strong>${label}:</strong> 
            <span class="trigger-value">${value.toFixed(1)}${unit}</span>
            <span class="trigger-limit">${limitStr}</span>
        </div>`;
}

/**
 * Encontra o pico (Min/Max) durante o período de alarme
 */
function findAlarmPeak(alarmReadings, config) {
  if (!alarmReadings || alarmReadings.length === 0)
    return { peakHtml: "", triggerKey: null };

  const startReading = alarmReadings[0];
  let triggerKey = null;
  let triggerType = null; // 'min' ou 'max'

  // 1. Descobre qual foi o gatilho inicial
  const keys = ["sonda", "temperaturaAmbiente", "umidade"];
  for (const key of keys) {
    if (triggerKey) break; 
    const val = startReading[key];
    if (val === null || val === undefined) continue;

    const min = config.alarmeMin?.[key];
    const max = config.alarmeMax?.[key];

    if (min !== undefined && min !== null && val < min) {
      triggerKey = key;
      triggerType = "min";
    } else if (max !== undefined && max !== null && val > max) {
      triggerKey = key;
      triggerType = "max";
    }
  }

  if (!triggerKey) return { peakHtml: "", triggerKey: null }; 

  // 2. Encontra o valor PICO (Min ou Max) de todas as leituras DO ALARME
  let peakValue = startReading[triggerKey];
  const allValues = alarmReadings
    .map((r) => r[triggerKey])
    .filter((v) => v !== null && v !== undefined);

  if (triggerType === "min") {
    peakValue = Math.min(...allValues);
  } else {
    peakValue = Math.max(...allValues);
  }

  // 3. Formata o HTML
  const labels = {
    sonda: "Sonda",
    temperaturaAmbiente: "Temp. Ambiente",
    umidade: "Umidade",
  };
  const units = { sonda: "°C", temperaturaAmbiente: "°C", umidade: "%" };

  // Exibir o pico (Mínimo ou Máximo)
  const peakLabel = triggerType === "min" ? "Leitura Mínima" : "Leitura Máxima";

  const peakHtml = `
        <div class="trigger-item peak">
            <strong>${peakLabel}:</strong> 
            <span class="trigger-value">${peakValue.toFixed(1)}${
    units[triggerKey]
  }</span>
        </div>`;

  return { peakHtml, triggerKey };
}

/**
 *Renderiza as estatísticas como cartões
 * e compara com os limites do deviceConfig.
 */
function renderStats(readings, deviceConfig) {
    const summaryEl = document.getElementById("stats-summary");
    if (!readings || readings.length === 0) {
        summaryEl.innerHTML = "<p>Nenhum dado no período.</p>";
        return;
    }

    // Helper interno para calcular métricas E obter limites
    const calculateMetrics = (readingKey, configKey) => {
        const values = readings
            .map((r) => r[readingKey])
            .filter((v) => v !== null && v !== undefined && typeof v === "number");

        // Pega os limites do firmware 
        const minLimit = deviceConfig?.alarmeMin?.[configKey];
        const maxLimit = deviceConfig?.alarmeMax?.[configKey];
        let hasError = false;

        if (values.length === 0) {
            return { avg: "N/A", max: "N/A", min: "N/A", minLimit, maxLimit, hasError };
        }
        
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = (sum / values.length);
        const max = Math.max(...values);
        const min = Math.min(...values);

        // Verifica se min/max ultrapassaram os limites
        if ((minLimit !== undefined && min < minLimit) || (maxLimit !== undefined && max > maxLimit)) {
            hasError = true;
        }
        
        return { avg, max, min, minLimit, maxLimit, hasError };
    };

    // Calcula para os 3 sensores
    const sondaStats = calculateMetrics("temperatura", "sonda");
    const ambStats = calculateMetrics("temperaturaAmbiente", "temperaturaAmbiente");
    const umidStats = calculateMetrics("umidade", "umidade");

    // Helper para formatar uma linha (Min ou Max)
    const formatStatLine = (label, value, limit, unit, type) => {
        if (value === "N/A") return `<p><strong>${label}:</strong> N/A</p>`;
        
        let isError = false;
        let limitStr = "";
        
        if (limit !== undefined && limit !== null) {
            limitStr = ` / (Limite: ${limit.toFixed(1)}${unit})`;
            if (type === 'min' && value < limit) isError = true;
            if (type === 'max' && value > limit) isError = true;
        }
        
        const valueStr = value.toFixed(2);
        
        // Adiciona classe 'stat-error' se estiver fora do limite
        return `<p class="${isError ? 'stat-error' : ''}">
                    <strong>${label}:</strong> ${valueStr}${unit}
                    <span class="stat-limit">${limitStr}</span>
                </p>`;
    };

    // Helper para formatar a Média
    const formatAvgLine = (label, value, unit) => {
         if (value === "N/A") return `<p><strong>${label}:</strong> N/A</p>`;
         return `<p><strong>${label}:</strong> ${value.toFixed(2)}${unit}</p>`;
    };

    // Monta o HTML final com os 3 cartões
    summaryEl.innerHTML = `
        <div class="stats-card ${sondaStats.hasError ? 'error-card' : ''}">
            <h4>🌡️ Temperatura Sonda</h4>
            ${formatAvgLine("Média", sondaStats.avg, "°C")}
            ${formatStatLine("Mínima", sondaStats.min, sondaStats.minLimit, "°C", 'min')}
            ${formatStatLine("Máxima", sondaStats.max, sondaStats.maxLimit, "°C", 'max')}
        </div>
        
        <div class="stats-card ${ambStats.hasError ? 'error-card' : ''}">
            <h4>🌡️ Temperatura Ambiente</h4>
            ${formatAvgLine("Média", ambStats.avg, "°C")}
            ${formatStatLine("Mínima", ambStats.min, ambStats.minLimit, "°C", 'min')}
            ${formatStatLine("Máxima", ambStats.max, ambStats.maxLimit, "°C", 'max')}
        </div>
        
        <div class="stats-card ${umidStats.hasError ? 'error-card' : ''}">
            <h4>💧 Umidade</h4>
            ${formatAvgLine("Média", umidStats.avg, "%")}
            ${formatStatLine("Mínima", umidStats.min, umidStats.minLimit, "%", 'min')}
            ${formatStatLine("Máxima", umidStats.max, umidStats.maxLimit, "%", 'max')}
        </div>
    `;
}

// export-csv, menu-toggle, showLoading, createLoader
document.getElementById("export-csv").addEventListener("click", () => {
  if (currentReadings.length === 0)
    return showNotification("Nenhum dado para exportar.", "info");
  let csv = "Data,Hora,Sonda,TemperaturaAmbiente,Umidade,Alarme\n";
  currentReadings.forEach((r) => {
    const dateStr = new Date(r.timestamp * 1000).toLocaleString("pt-BR");
    csv += `${dateStr},${r.temperatura ?? "N/A"},${
      r.temperaturaAmbiente ?? "N/A"
    },${r.umidade ?? "N/A"},${r.alarme ?? "N/A"}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leituras_${currentMac}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("menu-toggle").addEventListener("click", () => {
  document.getElementById("menu").classList.toggle("collapsed");
  document.getElementById("content").classList.toggle("expanded");
});
function showLoading(show) {
  let loader = document.getElementById("loading-indicator");
  if (!loader) {
    loader = createLoader();
  }
  loader.style.display = show ? "block" : "none";
}
function createLoader() {
  const loader = document.createElement("div");
  loader.id = "loading-indicator";
  loader.innerHTML = "Carregando...";
  loader.style.cssText =
    "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000;";
  document.body.appendChild(loader);
  return loader;
}

function calculateAllPeaks(readings, config) {
  const peaks = {};
  const keys = ["sonda", "temperaturaAmbiente", "umidade"];

  keys.forEach((key) => {
    const values = readings
      .map((r) => r[key])
      .filter((v) => v !== null && v !== undefined);

    if (values.length === 0) {
      peaks[key] = null;
      return;
    }

    const min = config.alarmeMin?.[key];
    const max = config.alarmeMax?.[key];
    const triggerType =
      min !== undefined && values[0] < min
        ? "min"
        : max !== undefined && values[0] > max
        ? "max"
        : null;

    if (!triggerType) {
      peaks[key] = null;
      return;
    }

    peaks[key] =
      triggerType === "min" ? Math.min(...values) : Math.max(...values);
  });

  return peaks;
}

function formatDisparoLine(sensor, config, peaks, triggerKey) {
  const { key, label, unit, value } = sensor;
  if (value === null || value === undefined) return "";

  const min = config.alarmeMin?.[key];
  const max = config.alarmeMax?.[key];
  const peak = peaks[key];

  const inAlarm =
    (min !== undefined && value < min) || (max !== undefined && value > max);
  if (!inAlarm && !peak) return "";

  const isTrigger = triggerKey === key;

  const minStr = min !== undefined ? min.toFixed(1) : "--";
  const maxStr = max !== undefined ? max.toFixed(1) : "--";
  const peakStr = peak !== null ? peak.toFixed(1) : "--";

  return `
        <div style="margin:8px 0; font-size:0.95em; line-height:1.4;">
            <strong style="color:${
              isTrigger ? "#e74c3c" : "#2c3e50"
            };">${label}:</strong>
            <span style="color:${
              isTrigger ? "#e74c3c" : "#2c3e50"
            }; font-weight:600;">
                ${value.toFixed(1)}${unit}
            </span>
            <span style="color:#7f8c8d; margin:0 6px;">|</span>
            <span style="color:#2c3e50;">
                ${minStr}${unit}
                <span style="color:#e74c3c; font-weight:bold;"> <alarmes> </span>
                ${maxStr}${unit}
            </span>
            ${
              peak !== null
                ? `
                <span style="color:#7f8c8d; margin:0 6px;">|</span>
                <strong style="color:#e67e22;">Leitura pico:</strong>
                <span style="color:#e67e22; font-weight:600;">${peakStr}${unit}</span>
            `
                : ""
            }
        </div>
    `;
}

// =======================================================
//  FUNÇÕES DO MODAL
// =======================================================
let modalChart = null; // Instância do gráfico do modal

/**
 * Abre o modal e preenche com dados e gráfico
 */
async function openAlarmGraph(alarmEvent, deviceConfig) {
    console.log("🔧 Abrindo modal para evento:", alarmEvent.id);
    
    const modal = document.getElementById("alarm-graph-modal");
    if (!modal) {
        console.error("❌ Modal não encontrado!");
        return;
    }

    // LIMPAR CONTEÚDO ANTERIOR
    document.getElementById("modal-device-name").textContent = "";
    document.getElementById("modal-device-mac").textContent = "";
    document.getElementById("modal-alarm-start").textContent = "";
    document.getElementById("modal-alarm-end").textContent = "";
    document.getElementById("modal-alarm-duration").textContent = "";
    document.getElementById("modal-alarm-trigger").innerHTML = "";
    document.getElementById("modal-event-details").innerHTML = "";

    // LIMPAR CANVAS DO GRÁFICO
    const canvas = document.getElementById("modal-chart");
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    //  DESTRUIR GRÁFICO ANTERIOR
    if (window.modalChart) {
        window.modalChart.destroy();
        window.modalChart = null;
    }

    //  CABEÇALHO DO EVENTO ---
    document.getElementById("modal-device-name").textContent =
        deviceConfig.nomeDispositivo || "Dispositivo";
    document.getElementById("modal-device-mac").textContent = currentMac;

    // Timestamps do evento
    const startDate = new Date(alarmEvent.startTimestamp * 1000);
    const endDate = alarmEvent.endTimestamp
        ? new Date(alarmEvent.endTimestamp * 1000)
        : null;

    document.getElementById("modal-alarm-start").textContent = `${formatDate(startDate)} ${formatTime(startDate)}`;
    document.getElementById("modal-alarm-end").textContent = endDate
        ? `${formatDate(endDate)} ${formatTime(endDate)}`
        : "Em andamento";

    // Duração
    const duration = endDate
        ? formatDuration((endDate - startDate) / 1000)
        : "Em andamento";
    document.getElementById("modal-alarm-duration").textContent = duration;

    //  SEÇÃO: PICOS DO EVENTO (Min/Max) ---
    
    // Busca as leituras *exatas* do período (sem buffer)
    const alarmPeriodReadings = await getAlarmPeriodReadings(alarmEvent);
    
    // Calcula os picos (min/max) a partir dessas leituras
    const eventPeaks = calculateEventPeaks(alarmPeriodReadings);
    
    // Formata a nova tabela HTML
    const peaksHtml = `
        <div class="peaks-section">
            <h4 style="margin:0 0 12px; color:#2c3e50; border-bottom:2px solid #3498db; padding-bottom:4px;">
                📈 Picos do Evento
            </h4>
            ${formatEventPeaks(eventPeaks)}
        </div>
    `;
    // Injeta o novo HTML no mesmo local
    document.getElementById("modal-alarm-trigger").innerHTML = peaksHtml;
    
    // --- SEÇÃO: DETALHES DO EVENTO 
    const detailsHtml = `
        <div class="details-section">
            <h4 style="margin:20px 0 12px; color:#2c3e50; border-bottom:2px solid #e67e22; padding-bottom:4px;">
                📋 Detalhes do Evento
            </h4>
            ${formatEventDetails(alarmEvent, deviceConfig)}
        </div>
    `;
    document.getElementById("modal-event-details").innerHTML = detailsHtml;

    // GRÁFICO DO EVENTO ---
    await renderModalChart(alarmEvent, deviceConfig);

    // MOSTRAR MODAL APÓS CARREGAR TUDO
    modal.style.display = "flex";
    setTimeout(() => {
        modal.classList.add("show");
    }, 50);
    
    console.log("✅ Modal aberto com sucesso");
}

/**
 *  FUNÇÃO ESPECÍFICA PARA O GRÁFICO DO MODAL
 */
async function renderModalChart(alarmEvent, deviceConfig) {
    console.log("🔧 Renderizando gráfico do modal para evento:", alarmEvent.id);
    
    const ctx = document.getElementById("modal-chart");
    if (!ctx) {
        console.error("❌ Canvas do gráfico modal não encontrado");
        return;
    }

    // DESTRUIR GRÁFICO ANTERIOR DO MODAL
    if (window.modalChart) {
        window.modalChart.destroy();
        window.modalChart = null;
    }

    try {
        // BUSCAR LEITURAS COM BUFFER DE 30min ANTES/DEPOIS
        const buffer = 30 * 60; // 30 minutos em segundos
        const startTimeWithBuffer = alarmEvent.startTimestamp - buffer;
        const endTimeWithBuffer = (alarmEvent.endTimestamp || Math.floor(Date.now() / 1000)) + buffer;
        
        console.log(`🔍 Buscando leituras de ${new Date(startTimeWithBuffer * 1000)} até ${new Date(endTimeWithBuffer * 1000)}`);
        
        const alarmReadingsQuery = query(
            collection(db, "dispositivos", currentMac, "leituras"),
            where("timestamp", ">=", startTimeWithBuffer),
            where("timestamp", "<=", endTimeWithBuffer),
            orderBy("timestamp")
        );
        
        const snapshot = await getDocs(alarmReadingsQuery);
        const alarmReadings = [];
        
        snapshot.docs.forEach(doc => {
            alarmReadings.push(doc.data());
        });
        
        if (alarmReadings.length === 0) {
            console.warn("⚠️ Nenhuma leitura encontrada para o período do alarme");
            ctx.getContext('2d').fillText('Nenhum dado disponível para este período', 50, 50);
            return;
        }

        console.log(`✅ ${alarmReadings.length} leituras encontradas (com buffer de 30min)`);

        // Preparar dados para o gráfico
        const labels = alarmReadings.map(r => new Date(r.timestamp * 1000));
        const sondaData = alarmReadings.map(r => r.temperatura);
        const ambienteData = alarmReadings.map(r => r.temperaturaAmbiente);
        const umidadeData = alarmReadings.map(r => r.umidade);

        // Criar gráfico do modal
        window.modalChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Sonda (°C)',
                        data: sondaData,
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        spanGaps: true
                    },
                    {
                        label: 'Ambiente (°C)',
                        data: ambienteData,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        spanGaps: true
                    },
                    {
                        label: 'Umidade (%)',
                        data: umidadeData,
                        borderColor: '#2ecc71',
                        backgroundColor: 'rgba(46, 204, 113, 0.1)',
                        borderWidth: 2,
                        tension: 0.1,
                        spanGaps: true,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute',
                            tooltipFormat: 'dd/MM/yyyy HH:mm'
                        },
                        title: {
                            display: true,
                            text: 'Horário'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Temperatura (°C)'
                        }
                    },
                    y1: {
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Umidade (%)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
        
        console.log("✅ Gráfico do modal renderizado com sucesso");
    } catch (error) {
        console.error("❌ Erro ao renderizar gráfico do modal:", error);
        
        // Mostrar erro no canvas
        const context = ctx.getContext('2d');
        context.clearRect(0, 0, ctx.width, ctx.height);
        context.fillStyle = '#e74c3c';
        context.fillText('Erro ao carregar gráfico: ' + error.message, 10, 50);
    }
}
// Busca leituras do período específico do alarme
async function getAlarmPeriodReadings(alarmEvent) {
  try {
    const startTimeStamp = alarmEvent.startTimestamp;
    const endTimeStamp =
      alarmEvent.endTimestamp || Math.floor(Date.now() / 1000);

    const alarmReadingsQuery = query(
      collection(db, "dispositivos", currentMac, "leituras"),
      where("timestamp", ">=", startTimeStamp),
      where("timestamp", "<=", endTimeStamp),
      orderBy("timestamp")
    );

    const snapshot = await getDocs(alarmReadingsQuery);
    const alarmReadings = [];
    snapshot.docs.forEach((doc) => {
      alarmReadings.push(doc.data());
    });

    return alarmReadings;
  } catch (error) {
    console.error("Erro ao buscar leituras do período do alarme:", error);
    return [];
  }
}

function closeModal() {
  const modal = document.getElementById("alarm-graph-modal");
  modal.classList.remove("show");
  setTimeout(() => {
    modal.style.display = "none";
    if (modalChart) {
      modalChart.destroy();
      modalChart = null;
    }
  }, 300);
}

// --- LISTENERS DO MODAL (Fechamento e Exportação) ---
document.getElementById("close-modal").addEventListener("click", closeModal);
document.getElementById("alarm-graph-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("alarm-graph-modal")) closeModal();
});

document.getElementById("export-png-btn").addEventListener("click", () => {
  // Seleciona o CONTEÚDO do modal, e não apenas o canvas
  const modalContent = document.querySelector(
    "#alarm-graph-modal .modal-content"
  );

  if (!modalContent) {
    showNotification("Erro: Modal não encontrado.", "error");
    return;
  }

  const deviceName = document
    .getElementById("modal-device-name")
    .textContent.trim();
  const startTime = document
    .getElementById("modal-alarm-start")
    .textContent.trim()
    .replace(/:/g, "-")
    .replace(/\//g, "-");
  const fileName = `Alarme_${deviceName}_${startTime}.jpg`;

  showNotification(
    "Gerando imagem... Isso pode levar alguns segundos.",
    "info"
  );

  // Usa a biblioteca html2canvas para "printar" o modal
  html2canvas(modalContent, {
    scale: 1.5, 
    useCORS: true,
    backgroundColor: "#ffffff", 
  })
    .then((canvas) => {
      const imgData = canvas.toDataURL("image/jpeg", 0.9); 

      const a = document.createElement("a");
      a.href = imgData;
      a.download = fileName;
      a.click();

      showNotification("Relatório de alarme exportado!", "success");
    })
    .catch((err) => {
      console.error("Erro ao gerar imagem com html2canvas:", err);
      showNotification("Falha ao gerar a imagem.", "error");
    });
});

/**
 * Formata as leituras iniciais que dispararam o alarme
 */
function formatTriggerReadings(startReading, triggeredBy, config) {
  const sensors = [
    {
      key: "temperatura",
      configKey: "sonda",
      label: "🌡️ Sonda",
      unit: "°C",
      value: startReading.temperatura,
      triggered: triggeredBy.includes("sonda"),
    },
    {
      key: "temperaturaAmbiente",
      configKey: "temperaturaAmbiente",
      label: "🌡️ Ambiente",
      unit: "°C",
      value: startReading.temperaturaAmbiente,
      triggered: triggeredBy.includes("temperaturaAmbiente"),
    },
    {
      key: "umidade",
      configKey: "umidade",
      label: "💧 Umidade",
      unit: "%",
      value: startReading.umidade,
      triggered: triggeredBy.includes("umidade"),
    },
  ];

  return sensors
    .map((sensor) => {
      if (sensor.value === null || sensor.value === undefined) return "";

      const min = config.alarmeMin?.[sensor.configKey];
      const max = config.alarmeMax?.[sensor.configKey];
      const isInAlarm =
        (min !== undefined && sensor.value < min) ||
        (max !== undefined && sensor.value > max);

      if (!isInAlarm && !sensor.triggered) return "";

      return `
            <div class="trigger-item ${sensor.triggered ? "triggered" : ""}" 
                 style="margin:8px 0; padding:8px; border-radius:6px; 
                        ${
                          sensor.triggered
                            ? "background:#ffeaa7; border-left:4px solid #e74c3c;"
                            : "background:#f8f9fa;"
                        }">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:#2c3e50;">${sensor.label}:</strong>
                    <span style="font-weight:600; color:${
                      sensor.triggered ? "#e74c3c" : "#2c3e50"
                    }">
                        ${sensor.value.toFixed(1)}${sensor.unit}
                    </span>
                </div>
                ${
                  sensor.triggered
                    ? `
                    <div style="margin-top:4px; font-size:0.9em; color:#7f8c8d;">
                        ${
                          min !== undefined && sensor.value < min
                            ? `⏬ Abaixo do mínimo: ${min.toFixed(1)}${
                                sensor.unit
                              }`
                            : `⏬ Acima do máximo: ${max.toFixed(1)}${
                                sensor.unit
                              }`
                        }
                    </div>
                `
                    : ""
                }
            </div>
        `;
    })
    .join("");
}

/**
 * Formata os detalhes do evento de forma compacta
 */
function formatEventDetails(alarmEvent, config) {
    // Obter os objetos de limites e leituras 
    const startLimites = alarmEvent.limitesIniciais || {};
    const endLimites = alarmEvent.limitesFinais || {};
    const endReading = alarmEvent.endReading || {};

    // Verificar se os limites mudaram 
    const limitesAlterados = verificarMudancasLimites(startLimites, endLimites);

    // Lógica dinâmica para definir o motivo 
    let motivoDisplay = '✅ Leituras normalizadas';
    let motivoCor = '#27ae60'; // Verde
    
    // Se a função de verificação detetou mudanças, força o motivo
    if (limitesAlterados.temMudancas) {
        motivoDisplay = '⚙️ Limites ajustados';
        motivoCor = '#e67e22'; 
    }

    // 4. Retornar o HTML 
    return `
        <div style="font-size:0.9em; line-height:1.3;">
            <div style="display:flex; justify-content:space-between; margin:8px 0;">
                <div>
                    <strong>🔔 Tipo:</strong> 
                    <span style="color:#e74c3c; font-weight:600;">${alarmEvent.tipoAlarme || 'N/A'}</span>
                </div>
                <div>
                    <strong>📈 Status:</strong> 
                    <span class="alarm-status ${alarmEvent.status}" style="padding:2px 8px;">${alarmEvent.status?.toUpperCase() || 'ATIVO'}</span>
                </div>
            </div>

            ${alarmEvent.status === 'resolvido' ? `
                <div style="margin:6px 0; padding:6px; background:#e8f5e8; border-radius:4px;">
                    <strong>🎯 Motivo:</strong> 
                    <span style="color:${motivoCor};">
                        ${motivoDisplay} 
                    </span>
                </div>
            ` : ''}

            <div style="margin:10px 0;">
                <strong>📏 Limites Vigentes:</strong>
                ${formatLimitesCompactos(startLimites)}
            </div>

            ${limitesAlterados.temMudancas ? `
                <div style="margin:8px 0; padding:6px; background:#fff3cd; border-radius:4px;">
                    <strong>🔄 Limites Alterados:</strong>
                    ${formatMudancasCompactas(limitesAlterados.mudancas)}
                </div>
            ` : ''}

            ${alarmEvent.status === 'resolvido' ? `
                <div style="margin:8px 0; padding:6px; background:#e8f4fd; border-radius:4px;">
                    <strong>📉 Leituras Finais:</strong>
                    ${formatEndReadingsCompact(endReading, config)}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Calcula os valores Mín/Máx de um array de leituras
 */
function calculateEventPeaks(readings) {
    const peaks = {
        sonda: { min: null, max: null },
        ambiente: { min: null, max: null },
        umidade: { min: null, max: null }
    };

    // Filtra valores válidos (números) para cada sensor
    const values = {
        sonda: readings
            .map(r => r.temperatura)
            .filter(v => typeof v === 'number' && !isNaN(v)),
        ambiente: readings
            .map(r => r.temperaturaAmbiente)
            .filter(v => typeof v === 'number' && !isNaN(v)),
        umidade: readings
            .map(r => r.umidade)
            .filter(v => typeof v === 'number' && !isNaN(v))
    };

    // Calcula Min/Max se houver dados
    if (values.sonda.length > 0) {
        peaks.sonda = {
            min: Math.min(...values.sonda),
            max: Math.max(...values.sonda)
        };
    }
    if (values.ambiente.length > 0) {
        peaks.ambiente = {
            min: Math.min(...values.ambiente),
            max: Math.max(...values.ambiente)
        };
    }
    if (values.umidade.length > 0) {
        peaks.umidade = {
            min: Math.min(...values.umidade),
            max: Math.max(...values.umidade)
        };
    }
    
    return peaks;
}

/**
 * Formata os picos do evento (Min/Max) em uma tabela
 */
function formatEventPeaks(peaks) {
    const sensors = [
        { key: 'sonda', label: 'Sonda', unit: '°C' },
        { key: 'ambiente', label: 'Ambiente', unit: '°C' },
        { key: 'umidade', label: 'Umidade', unit: '%' }
    ];

    const rows = sensors.map(sensor => {
        const data = peaks[sensor.key];
        // Formata o valor ou exibe '--' se for nulo
        const min = (data.min !== null) ? `${data.min.toFixed(1)}${sensor.unit}` : '--';
        const max = (data.max !== null) ? `${data.max.toFixed(1)}${sensor.unit}` : '--';

        return `
            <tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:4px 8px 4px 0; font-size:0.9em;"><strong>${sensor.label}</strong></td>
                <td style="padding:4px 8px; text-align:center; font-size:0.9em; color:#3498db; font-weight:600;">
                    ${min}
                </td>
                <td style="padding:4px 8px; text-align:center; font-size:0.9em; color:#e74c3c; font-weight:600;">
                    ${max}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div style="margin-top:4px;">
            <table style="width:100%; font-size:0.85em; border-collapse:collapse; background:#f8f9fa; border-radius:4px;">
                <thead>
                    <tr style="background:#e9ecef;">
                        <th style="padding:5px 8px; text-align:left; font-size:0.85em;">Sensor</th>
                        <th style="padding:5px 8px; text-align:center; font-size:0.85em;">Mín. Evento</th>
                        <th style="padding:5px 8px; text-align:center; font-size:0.85em;">Máx. Evento</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}


/**
 *  TABELA DE LIMITES MAIS COMPACTA
 */
function formatLimitesCompactos(limites) {
    const sensors = [
        { key: 'sonda', label: 'Sonda', unit: '°C' },
        { key: 'temperaturaAmbiente', label: 'Ambiente', unit: '°C' },
        { key: 'umidade', label: 'Umidade', unit: '%' }
    ];

    const rows = sensors.map(sensor => {
        const sensorLimites = limites[sensor.key] || {};
        return `
            <tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:3px 8px 3px 0; font-size:0.85em;"><strong>${sensor.label}</strong></td>
                <td style="padding:3px 8px; text-align:center; font-size:0.85em;">
                    ${sensorLimites.min?.toFixed(1) || '--'}${sensor.unit}
                </td>
                <td style="padding:3px 8px; text-align:center; font-size:0.85em;">
                    ${sensorLimites.max?.toFixed(1) || '--'}${sensor.unit}
                </td>
                <td style="padding:3px 8px; text-align:center; font-size:0.85em;">
                    ${sensorLimites.ativo ? '✅' : '❌'}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div style="margin-top:4px;">
            <table style="width:100%; font-size:0.85em; border-collapse:collapse; background:#f8f9fa; border-radius:4px;">
                <thead>
                    <tr style="background:#e9ecef;">
                        <th style="padding:4px 8px; text-align:left; font-size:0.8em;">Sensor</th>
                        <th style="padding:4px 8px; text-align:center; font-size:0.8em;">Mín</th>
                        <th style="padding:4px 8px; text-align:center; font-size:0.8em;">Máx</th>
                        <th style="padding:4px 8px; text-align:center; font-size:0.8em;">Ativo</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            ${limites.histerese ? `
                <div style="margin-top:4px; color:#7f8c8d; font-size:0.8em;">
                    <strong>Histerese:</strong> ${limites.histerese}°C
                </div>
            ` : ''}
        </div>
    `;
}
/**
 *  MUDANÇAS DE LIMITES DE FORMA COMPACTA
 */
function formatMudancasCompactas(mudancas) {
    if (!mudancas || mudancas.length === 0) return '';
    
    const labels = { 
        sonda: 'Sonda', 
        temperaturaAmbiente: 'Ambiente', 
        umidade: 'Umidade' 
    };
    
    return mudancas.map(mudanca => {
        const changes = [];
        
        if (mudanca.min.alterado) {
            changes.push(`Mín: ${mudanca.min.inicio}→${mudanca.min.fim}°C`);
        }
        if (mudanca.max.alterado) {
            changes.push(`Máx: ${mudanca.max.inicio}→${mudanca.max.fim}°C`);
        }
        if (mudanca.ativo.alterado) {
            changes.push(`${mudanca.ativo.inicio ? '✅' : '❌'}→${mudanca.ativo.fim ? '✅' : '❌'}`);
        }
        
        return `
            <div style="margin:2px 0; font-size:0.85em;">
                <strong>${labels[mudanca.sensor]}:</strong> ${changes.join(' | ')}
            </div>
        `;
    }).join('');
}

/**
 *  LEITURAS FINAIS COMPACTAS
 */
function formatEndReadingsCompact(endReading, config) {
    const sensors = [
        { key: 'temperatura', label: 'Sonda', unit: '°C', value: endReading.temperatura },
        { key: 'temperaturaAmbiente', label: 'Ambiente', unit: '°C', value: endReading.temperaturaAmbiente },
        { key: 'umidade', label: 'Umidade', unit: '%', value: endReading.umidade }
    ];

    const readings = sensors.map(sensor => {
        if (sensor.value === null || sensor.value === undefined) return '';
        
        const stillInAlarm = endReading[`alarme${sensor.label.replace(' ', '')}`];
        
        return `
            <span style="margin-right:12px; color:${stillInAlarm ? '#e74c3c' : '#27ae60'};">
                ${sensor.label}: ${sensor.value.toFixed(1)}${sensor.unit}
                ${stillInAlarm ? ' ⚠️' : ' ✅'}
            </span>
        `;
    }).join('');

    return `<div style="margin-top:4px;">${readings}</div>`;
}

/**
 * Formata duração de forma legível
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}
/**
 *  VERIFICA SE HOUVE MUDANÇAS REAIS NOS LIMITES
 */
function verificarMudancasLimites(inicio, fim) {
    const mudancas = [];
    
    ['sonda', 'temperaturaAmbiente', 'umidade'].forEach(key => {
        const inicioLim = inicio[key] || {};
        const fimLim = fim[key] || {};
        
        // Verificar mudanças significativas
        const minAlterado = inicioLim.min !== fimLim.min;
        const maxAlterado = inicioLim.max !== fimLim.max;
        const ativoAlterado = inicioLim.ativo !== fimLim.ativo;
        
        if (minAlterado || maxAlterado || ativoAlterado) {
            mudancas.push({
                sensor: key,
                min: { inicio: inicioLim.min, fim: fimLim.min, alterado: minAlterado },
                max: { inicio: inicioLim.max, fim: fimLim.max, alterado: maxAlterado },
                ativo: { inicio: inicioLim.ativo, fim: fimLim.ativo, alterado: ativoAlterado }
            });
        }
    });
    
    return {
        temMudancas: mudancas.length > 0,
        mudancas: mudancas
    };
}
