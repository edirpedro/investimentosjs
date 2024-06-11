import config from "/config.js";
import { App } from "./app.js";
import { calculaAcumulado, preparaData } from "./compartilhado.js";

let CACHE;

// Carrega os dados no cache
// Dados são diários mas contém o acumulado do aniversário, são mensais a cada dia
// 1º dia do mês representa o valor mensal divulgado
// A leitura fica sendo mensal, igual IPCA

export async function loadPoupanca() {
  let url = encodeURIComponent(
    "https://api.bcb.gov.br/dados/serie/bcdata.sgs.195/dados?formato=json"
  );
  return fetch(`${config.proxy}?name=poupanca&url=${url}`)
    .then((response) => response.json())
    .then((response) => {
      let json = response.map((item) => {
        let data = item.data.split("/");
        item.dia = parseInt(data[0]); // Auxilia na separação de dados mensais
        item.data = data.reverse().join("-");
        item.data = luxon.DateTime.fromISO(item.data).toMillis();
        item.datafim = item.datafim.split("/").reverse().join("-");
        item.datafim = luxon.DateTime.fromISO(item.datafim).toMillis();
        item.valor = parseFloat(item.valor);
        return item;
      });
      json.sort((a, b) => a.data - b.data); // Ordem crescente
      CACHE = json;
    });
}

App.addLoad(loadPoupanca);

/**
 * Retorna os dados brutos, clonados para evitar alterações por referência
 * @returns {array}
 */
export function poupancaDados() {
  return [...CACHE.map((item) => ({ ...item }))]; // Clonagem rápida
}

/**
 * Retorna os dados mensais do dia 1º de cada mês, aqueles divulgados na internet
 * @returns {array}
 */
export function poupancaDadosMensais() {
  return poupancaDados().filter((item) => item.dia === 1);
}

/**
 * Retorna o valor do mês
 * @param {number} month - Mês
 * @param {number} year  - Ano
 * @returns {number}
 */
export function poupancaMes(month, year) {
  let data = luxon.DateTime.fromObject({ month, year })
    .startOf("month")
    .toMillis();
  let dados = poupancaDadosMensais().find((item) => item.data == data);
  return dados ? dados.valor : null;
}

/**
 * Retorna os dados mensais de um período
 * poupancaMensal(de, ate, true).map((item) => [item.data, item.valor]) - Mapeia para uma série do gráfico
 * poupancaMensal(de, ate).map((item) => item.valor) - Separa apenas os valores
 * poupancaMensal(de, ate, true).at(-1).valor - Pega o valor final acumulado do período
 * @param {timestamp|ISO|DateTime} de - Data de início
 * @param {timestamp|ISO|DateTime} ate - Date final
 * @param {boolean} acumulado - Realiza o acumulado dos dados
 * @returns {array}
 */
export function poupancaMensal(de = null, ate = null, acumulado = false) {
  de = preparaData(de ? de : "2000-01-01")
    .startOf("month")
    .toMillis();
  ate = preparaData(ate ? ate : luxon.DateTime.now())
    .startOf("month")
    .toMillis();
  let dados = poupancaDadosMensais().filter(
    (item) => item.data >= de && item.data <= ate
  );
  return acumulado ? calculaAcumulado(dados, "valor") : dados;
}

/**
 * Retorna os dados dos últimos 12 meses
 * @param {boolean} acumulado - Realiza o acumulado dos dados
 * @returns {array}
 */
export function poupanca12meses(acumulado = false) {
  let dados = poupancaDadosMensais().slice(-12);
  return acumulado ? calculaAcumulado(dados, "valor") : dados;
}

/**
 * Retorna a média mensal dos últimos 12 meses
 * @returns {number}
 */
export function poupancaMediaAno() {
  return poupanca12meses().reduce((soma, item) => (soma += item.valor), 0) / 12;
}

/**
 * Retorna o acumulado dos últimos 12 meses
 * @returns {number}
 */
export function poupancaAcumuladoAno() {
  return poupanca12meses(true).at(-1).valor;
}

// TODO uma ideia para ter aportes  seria usar a entrada investimentos[[timestamp, valor]]
// depois ao percorrer os aniversários ir incluindo estes valores.

/**
 * Cálculo de correção da Poupança
 *
 * Segue a metodologia explicada na calculadora do cidadão.
 * https://www3.bcb.gov.br/CALCIDADAO/publico/corrigirPelaPoupanca.do?method=corrigirPelaPoupanca
 *
 * Método não acompanha aportes, entendo que é desnecessário,
 * serve para olhar para a rentabiliadde e não os rendimentos.
 *
 * @param {number} investimento - Valor do investimento
 * @param {timestamp} de - Data inicial do investimento
 * @param {timestamp} ate - Data final do investimento
 * @returns {number} - Valor do investimento corrigido
 */
export function poupancaCorrigida(investimento, de, ate = null) {
  de = luxon.DateTime.fromMillis(de).startOf("day");
  ate = ate
    ? luxon.DateTime.fromMillis(ate).startOf("day")
    : luxon.DateTime.now().startOf("day");

  // Dias 29, 30 e 31 avançam para o dia 1.
  if (de.day > 28) de = de.endOf("month").plus({ days: 1 }).startOf("day");

  // Contagem de aniversários
  let nivers = luxon.Interval.fromDateTimes(de, ate)
    .splitBy({ months: 1 })
    .map((item) => item.end) // pega os intervalos finais
    .filter((item) => item.day == de.day) // apenas as datas com dia do aniversário
    .map((item) => item.toMillis()); // converte para buscar no json

  // Ainda não completou o primeiro aniversário
  if (nivers.length == 0) return investimento;

  // Índices da poupança
  let poupanca = poupancaDados()
    .filter((item) => nivers.includes(item.datafim))
    .map((item) => item.valor);

  // Cálculo de correção
  let indice = 1;
  nivers.forEach((item, index) => {
    indice *= 1 + poupanca[index] / 100;
  });
  investimento *= indice;

  return investimento;
}