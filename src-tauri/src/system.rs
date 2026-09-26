use serde::Serialize;
use std::{path::Path, time::Duration};
use sysinfo::{Disks, System};
use tokio::{process::Command, time::timeout};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelFit {
    size: &'static str,
    rating: &'static str,
    required_ram_gb: u64,
    required_vram_gb: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardwareInfo {
    cpu: String,
    physical_cores: usize,
    logical_cores: usize,
    ram_bytes: u64,
    available_ram_bytes: u64,
    disk_total_bytes: Option<u64>,
    disk_available_bytes: Option<u64>,
    volumes: Vec<VolumeInfo>,
    physical_disks: Vec<PhysicalDiskInfo>,
    gpu: Option<String>,
    vram_bytes: Option<u64>,
    recommendations: Vec<ModelFit>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VolumeInfo {
    name: String,
    mount_point: String,
    file_system: String,
    kind: String,
    total_bytes: u64,
    available_bytes: u64,
    removable: bool,
    read_only: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhysicalDiskInfo {
    model: String,
    media_type: String,
    bus_type: String,
    size_bytes: Option<u64>,
    health: Option<String>,
    operational_status: Option<String>,
    firmware: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputerRoot {
    id: String,
    name: String,
    path: String,
}

#[tauri::command]
pub(crate) fn list_computer_roots() -> Vec<ComputerRoot> {
    #[cfg(target_os = "windows")]
    {
        return (b'A'..=b'Z')
            .filter_map(|letter| {
                let path = format!("{}:\\", letter as char);
                Path::new(&path).is_dir().then(|| ComputerRoot {
                    id: format!("computer-{}", (letter as char).to_ascii_lowercase()),
                    name: format!("Unidad {}:", letter as char),
                    path,
                })
            })
            .collect();
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![ComputerRoot {
            id: "computer-root".into(),
            name: "Sistema de archivos".into(),
            path: "/".into(),
        }]
    }
}

#[cfg(target_os = "windows")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct VideoController {
    name: Option<String>,
    adapter_ram: Option<u64>,
}

#[cfg(target_os = "windows")]
async fn detect_gpu() -> (Option<String>, Option<u64>) {
    let mut command = Command::new("powershell.exe");
    command.kill_on_drop(true).args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
    ]);
    // This is an internal settings probe. Its output is captured by Vareliox,
    // so Windows must not create a console window for it.
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let Ok(Ok(output)) = timeout(Duration::from_secs(4), command.output()).await else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (None, None);
    };
    let values = value.as_array().cloned().unwrap_or_else(|| vec![value]);
    let controllers = values
        .into_iter()
        .filter_map(|item| serde_json::from_value::<VideoController>(item).ok())
        .collect::<Vec<_>>();
    let name = controllers
        .iter()
        .filter_map(|item| item.name.as_deref())
        .find(|name| !name.to_ascii_lowercase().contains("basic display"))
        .map(str::to_string);
    let vram = controllers.iter().filter_map(|item| item.adapter_ram).max();
    (name, vram)
}

#[cfg(target_os = "windows")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsPhysicalDisk {
    friendly_name: Option<String>,
    media_type: Option<String>,
    bus_type: Option<String>,
    size: Option<u64>,
    health_status: Option<String>,
    operational_status: Option<String>,
    firmware_version: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_windows_physical_disks(bytes: &[u8]) -> Vec<PhysicalDiskInfo> {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return Vec::new();
    };
    value
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![value])
        .into_iter()
        .filter_map(|item| serde_json::from_value::<WindowsPhysicalDisk>(item).ok())
        .filter_map(|disk| {
            let model = disk.friendly_name?.trim().to_string();
            (!model.is_empty()).then_some(PhysicalDiskInfo {
                model,
                media_type: disk.media_type.unwrap_or_else(|| "No especificado".into()),
                bus_type: disk.bus_type.unwrap_or_else(|| "No especificado".into()),
                size_bytes: disk.size,
                health: disk.health_status,
                operational_status: disk.operational_status,
                firmware: disk.firmware_version,
            })
        })
        .collect()
}

#[cfg(target_os = "windows")]
async fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
    let mut command = Command::new("powershell.exe");
    command.kill_on_drop(true).args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-PhysicalDisk | Select-Object FriendlyName,@{Name='MediaType';Expression={$_.MediaType.ToString()}},@{Name='BusType';Expression={$_.BusType.ToString()}},Size,@{Name='HealthStatus';Expression={$_.HealthStatus.ToString()}},@{Name='OperationalStatus';Expression={($_.OperationalStatus -join ', ')}},FirmwareVersion | ConvertTo-Json -Compress",
    ]);
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let Ok(Ok(output)) = timeout(Duration::from_secs(5), command.output()).await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_windows_physical_disks(&output.stdout)
}

#[cfg(target_os = "linux")]
async fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
    let mut command = Command::new("lsblk");
    command.kill_on_drop(true).args([
        "--json",
        "--bytes",
        "--nodeps",
        "--output",
        "NAME,MODEL,SIZE,ROTA,TRAN,TYPE",
    ]);
    let Ok(Ok(output)) = timeout(Duration::from_secs(5), command.output()).await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return Vec::new();
    };
    value["blockdevices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|disk| disk["type"].as_str() == Some("disk"))
        .map(|disk| {
            let name = disk["name"].as_str().unwrap_or("Disco");
            let model = disk["model"].as_str().unwrap_or("").trim();
            let rotational = disk["rota"].as_bool();
            PhysicalDiskInfo {
                model: if model.is_empty() {
                    name.into()
                } else {
                    model.into()
                },
                media_type: match rotational {
                    Some(true) => "HDD".into(),
                    Some(false) => "SSD".into(),
                    None => "No especificado".into(),
                },
                bus_type: disk["tran"].as_str().unwrap_or("No especificado").into(),
                size_bytes: disk["size"].as_u64(),
                ..PhysicalDiskInfo::default()
            }
        })
        .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
async fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
    Vec::new()
}

#[cfg(target_os = "linux")]
async fn detect_gpu() -> (Option<String>, Option<u64>) {
    let mut command = Command::new("nvidia-smi");
    command.kill_on_drop(true).args([
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
    ]);
    if let Ok(Ok(output)) = timeout(Duration::from_secs(4), command.output()).await {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let mut values = line.split(',').map(str::trim);
                let name = values
                    .next()
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let vram = values
                    .next()
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|mib| mib * 1024 * 1024);
                if name.is_some() {
                    return (name, vram);
                }
            }
        }
    }

    let mut command = Command::new("lspci");
    command.kill_on_drop(true);
    let Ok(Ok(output)) = timeout(Duration::from_secs(4), command.output()).await else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let name = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("vga compatible controller") || lower.contains("3d controller")
        })
        .and_then(|line| {
            line.split_once(": ")
                .map(|(_, value)| value.trim().to_string())
        });
    (name, None)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
async fn detect_gpu() -> (Option<String>, Option<u64>) {
    (None, None)
}

fn model_fits(ram: u64, vram: Option<u64>) -> Vec<ModelFit> {
    let gib = 1024_u64.pow(3);
    let vram = vram.unwrap_or_default();
    [
        ("7B / 8B", 16 * gib, 6 * gib),
        ("14B", 24 * gib, 10 * gib),
        ("30B / 32B", 48 * gib, 20 * gib),
        ("70B", 96 * gib, 48 * gib),
    ]
    .into_iter()
    .map(|(label, needed_ram, needed_vram)| {
        let rating = if vram >= needed_vram {
            "excellent"
        } else if ram >= needed_ram {
            "acceptable"
        } else {
            "not_recommended"
        };
        ModelFit {
            size: label,
            rating,
            required_ram_gb: needed_ram / gib,
            required_vram_gb: needed_vram / gib,
        }
    })
    .collect()
}

#[tauri::command]
pub(crate) async fn inspect_hardware(root: Option<String>) -> Result<HardwareInfo, String> {
    let mut system = System::new_all();
    system.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let project_path = root.as_deref().map(Path::new);
    let selected_disk = disks
        .list()
        .iter()
        .filter(|disk| project_path.is_none_or(|path| path.starts_with(disk.mount_point())))
        .max_by_key(|disk| disk.mount_point().as_os_str().len());
    let disk_total_bytes = selected_disk.map(|disk| disk.total_space());
    let disk_available_bytes = selected_disk.map(|disk| disk.available_space());
    let volumes = disks
        .list()
        .iter()
        .map(|disk| VolumeInfo {
            name: disk.name().to_string_lossy().to_string(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            file_system: disk.file_system().to_string_lossy().to_string(),
            kind: disk.kind().to_string(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
            removable: disk.is_removable(),
            read_only: disk.is_read_only(),
        })
        .collect();
    let ((gpu, vram_bytes), physical_disks) = tokio::join!(detect_gpu(), detect_physical_disks());
    let ram_bytes = system.total_memory();
    Ok(HardwareInfo {
        cpu: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "CPU no identificada".into()),
        physical_cores: System::physical_core_count().unwrap_or_default(),
        logical_cores: system.cpus().len(),
        ram_bytes,
        available_ram_bytes: system.available_memory(),
        disk_total_bytes,
        disk_available_bytes,
        volumes,
        physical_disks,
        gpu,
        vram_bytes,
        recommendations: model_fits(ram_bytes, vram_bytes),
    })
}

pub(crate) async fn system_summary(root: Option<String>) -> Result<String, String> {
    let info = inspect_hardware(root).await?;
    let gib = |value: u64| value as f64 / 1024_f64.powi(3);
    let mut summary = format!(
        "Sistema operativo: {}\nCPU: {}\nNúcleos físicos/lógicos: {}/{}\nRAM total: {:.1} GB\nRAM disponible: {:.1} GB\nGPU: {}\nVRAM: {}\nAlmacenamiento total en el disco de trabajo: {}\nAlmacenamiento usado: {}\nAlmacenamiento disponible: {}",
        std::env::consts::OS,
        info.cpu,
        info.physical_cores,
        info.logical_cores,
        gib(info.ram_bytes),
        gib(info.available_ram_bytes),
        info.gpu.unwrap_or_else(|| "No detectada".into()),
        info.vram_bytes.map(|value| format!("{:.1} GB", gib(value))).unwrap_or_else(|| "No disponible".into()),
        info.disk_total_bytes.map(|value| format!("{:.1} GB", gib(value))).unwrap_or_else(|| "No disponible".into()),
        info.disk_total_bytes.zip(info.disk_available_bytes).map(|(total, available)| format!("{:.1} GB", gib(total.saturating_sub(available)))).unwrap_or_else(|| "No disponible".into()),
        info.disk_available_bytes.map(|value| format!("{:.1} GB", gib(value))).unwrap_or_else(|| "No disponible".into()),
    );
    summary.push_str("\n\nDISCOS FÍSICOS:");
    if info.physical_disks.is_empty() {
        summary.push_str("\nNo fue posible obtener el modelo físico con los permisos actuales.");
    } else {
        for (index, disk) in info.physical_disks.iter().enumerate() {
            summary.push_str(&format!(
                "\n{}. Modelo: {} | Tipo: {} | Interfaz: {} | Capacidad: {} | Salud: {} | Estado: {} | Firmware: {}",
                index + 1,
                disk.model,
                disk.media_type,
                disk.bus_type,
                disk.size_bytes.map(|value| format!("{:.1} GB", gib(value))).unwrap_or_else(|| "No disponible".into()),
                disk.health.as_deref().unwrap_or("No disponible"),
                disk.operational_status.as_deref().unwrap_or("No disponible"),
                disk.firmware.as_deref().unwrap_or("No disponible"),
            ));
        }
    }
    summary.push_str("\n\nUNIDADES Y VOLÚMENES:");
    if info.volumes.is_empty() {
        summary.push_str("\nNo se detectaron volúmenes montados.");
    } else {
        for volume in &info.volumes {
            summary.push_str(&format!(
                "\n- {} ({}) | Nombre: {} | Formato: {} | Tipo: {} | Total: {:.1} GB | Usado: {:.1} GB | Disponible: {:.1} GB | Extraíble: {} | Solo lectura: {}",
                volume.mount_point,
                if volume.mount_point.is_empty() { "sin montar" } else { "montado" },
                if volume.name.is_empty() { "Sin nombre" } else { &volume.name },
                if volume.file_system.is_empty() { "No disponible" } else { &volume.file_system },
                volume.kind,
                gib(volume.total_bytes),
                gib(volume.total_bytes.saturating_sub(volume.available_bytes)),
                gib(volume.available_bytes),
                if volume.removable { "sí" } else { "no" },
                if volume.read_only { "sí" } else { "no" },
            ));
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommendations_reject_models_that_do_not_fit() {
        let fits = model_fits(8 * 1024_u64.pow(3), Some(4 * 1024_u64.pow(3)));
        assert_eq!(fits[0].rating, "not_recommended");
        assert_eq!(fits[3].rating, "not_recommended");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_windows_ssd_details_without_serial_numbers() {
        let disks = parse_windows_physical_disks(
            br#"[{"FriendlyName":"Example NVMe 1TB","MediaType":"SSD","BusType":"NVMe","Size":1000204886016,"HealthStatus":"Healthy","OperationalStatus":"OK","FirmwareVersion":"1.0"}]"#,
        );
        assert_eq!(disks.len(), 1);
        assert_eq!(disks[0].model, "Example NVMe 1TB");
        assert_eq!(disks[0].media_type, "SSD");
        assert_eq!(disks[0].bus_type, "NVMe");
        assert_eq!(disks[0].health.as_deref(), Some("Healthy"));
        assert_eq!(disks[0].firmware.as_deref(), Some("1.0"));
    }

    #[tokio::test]
    async fn system_summary_reports_real_capacity_without_a_shell() {
        let temporary = tempfile::tempdir().unwrap();
        let summary = system_summary(Some(temporary.path().to_string_lossy().to_string()))
            .await
            .unwrap();
        assert!(summary.contains("RAM total:"));
        assert!(summary.contains("Almacenamiento total"));
        assert!(summary.contains("Almacenamiento usado"));
        assert!(summary.contains("Almacenamiento disponible"));
        assert!(summary.contains("DISCOS FÍSICOS:"));
        assert!(summary.contains("UNIDADES Y VOLÚMENES:"));
        assert!(summary.contains(std::env::consts::OS));
    }
}
