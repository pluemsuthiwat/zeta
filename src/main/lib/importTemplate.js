import ExcelJS from 'exceljs'

const TEMPLATES = {
  static: {
    fileName: 'ap-import-template-static-ip.xlsx',
    columns: ['Serial Number', 'MAC Address', 'New Name', 'New Group', 'IP', 'Netmask', 'Gateway', 'DNS', 'Master'],
    example: ['ABC123456', 'AA:BB:CC:DD:EE:FF', 'Example-AP-Name', 'Example-Group', '192.168.1.50', '255.255.255.0', '192.168.1.1', '8.8.8.8', '']
  },
  dhcp: {
    fileName: 'ap-import-template-dhcp.xlsx',
    columns: ['Serial Number', 'MAC Address', 'New Name', 'New Group', 'IP', 'Master'],
    example: ['ABC123456', 'AA:BB:CC:DD:EE:FF', 'Example-AP-Name', 'Example-Group', 'DHCP', '']
  }
}

export function templateFileName(type) {
  return (TEMPLATES[type] || TEMPLATES.static).fileName
}

/** Serial and MAC columns are formatted as Text so Excel keeps leading zeros (00123 stays 00123). */
export async function buildTemplate(type) {
  const t = TEMPLATES[type] || TEMPLATES.static
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('APs')
  ws.columns = t.columns.map((header) => ({ header, width: Math.max(16, header.length + 4) }))
  ws.getColumn(1).numFmt = '@'
  ws.getColumn(2).numFmt = '@'
  ws.getRow(1).font = { bold: true }
  ws.addRow(t.example)
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return Buffer.from(await wb.xlsx.writeBuffer())
}
