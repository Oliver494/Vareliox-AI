use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, StatusCode};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::{fs::File, io::Write, process::Command};
use tauri::AppHandle;
use url::Url;

const RELEASES_API: &str =
    "https://api.github.com/repos/Oliver494/Vareliox-AI/releases?per_page=30";
const RELEASE_PATH_PREFIX: &str = "/oliver494/vareliox-ai/releases/";
const DOWNLOAD_PATH_PREFIX: &str = "/oliver494/vareliox-ai/releases/download/";
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
#[cfg(any(target_os = "windows", target_os = "macos"))]
const MAX_INSTALLER_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    Stable,
    Experimental,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    version: String,
    tag: String,
    title: String,
    notes: String,
    url: String,
    asset_url: Option<String>,
    prerelease: bool,
    published_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    status: String,
    installed_version: String,
    checked_at: u64,
    message: String,
    release: Option<UpdateRelease>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn result(
    status: &str,
    installed: &str,
    message: &str,
    release: Option<UpdateRelease>,
) -> UpdateCheckResult {
    UpdateCheckResult {
        status: status.into(),
        installed_version: installed.into(),
        checked_at: now_millis(),
        message: message.into(),
        release,
    }
}

fn parse_version(value: &str) -> Option<Version> {
    Version::parse(value.trim().trim_start_matches(['v', 'V'])).ok()
}

fn is_official_release_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url
                .path()
                .to_ascii_lowercase()
                .starts_with(RELEASE_PATH_PREFIX)
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn is_official_download_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url
                .path()
                .to_ascii_lowercase()
                .starts_with(DOWNLOAD_PATH_PREFIX)
            && url.username().is_empty()
            && url.password().is_none()
    })
}

fn installer_rank(name: &str, os: &str, arch: &str) -> Option<u8> {
    let name = name.to_ascii_lowercase();
    let is_arm = name.contains("aarch64") || name.contains("arm64");
    let is_x64 = name.contains("x86_64") || name.contains("amd64") || name.contains("x64");
    let is_universal = name.contains("universal");
    let architecture_matches = is_universal
        || match arch {
            "aarch64" => is_arm,
            "x86_64" => is_x64,
            _ => !is_arm && !is_x64,
        };
    if !architecture_matches {
        return None;
    }
    match os {
        "windows" if name.ends_with(".exe") => Some(0),
        "linux" if name.ends_with(".deb") => Some(0),
        "linux" if name.ends_with(".appimage") => Some(1),
        "macos" if name.ends_with(".dmg") && is_universal => Some(0),
        "macos" if name.ends_with(".dmg") => Some(1),
        _ => None,
    }
}

fn release_asset_url(release: &GitHubRelease, os: &str, arch: &str) -> Option<String> {
    let mut assets = release
        .assets
        .iter()
        .filter(|asset| is_official_download_url(&asset.browser_download_url))
        .filter_map(|asset| installer_rank(&asset.name, os, arch).map(|rank| (rank, asset)))
        .collect::<Vec<_>>();
    assets.sort_by_key(|(rank, _)| *rank);
    assets
        .first()
        .map(|(_, asset)| asset.browser_download_url.clone())
}

fn select_release(
    body: &[u8],
    installed: &str,
    channel: UpdateChannel,
) -> Result<Option<UpdateRelease>, ()> {
    let releases: Vec<GitHubRelease> = serde_json::from_slice(body).map_err(|_| ())?;
    let installed_version = parse_version(installed).ok_or(())?;
    let mut eligible = releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter(|release| matches!(channel, UpdateChannel::Experimental) || !release.prerelease)
        .filter_map(|release| parse_version(&release.tag_name).map(|version| (version, release)))
        .filter(|(version, _)| version > &installed_version)
        .collect::<Vec<_>>();
    eligible.sort_by(|left, right| right.0.cmp(&left.0));
    let Some((version, release)) = eligible.into_iter().next() else {
        return Ok(None);
    };
    if !is_official_release_url(&release.html_url) {
        return Err(());
    }
    let asset_url = release_asset_url(&release, std::env::consts::OS, std::env::consts::ARCH);
    let notes = release
        .body
        .unwrap_or_default()
        .chars()
        .take(1_000)
        .collect();
    Ok(Some(UpdateRelease {
        version: version.to_string(),
        tag: release.tag_name.clone(),
        title: release.name.unwrap_or(release.tag_name),
        notes,
        url: release.html_url,
        asset_url,
        prerelease: release.prerelease,
        published_at: release.published_at,
    }))
}

async fn fetch_releases(
    endpoint: &str,
    installed: &str,
    channel: UpdateChannel,
    timeout: Duration,
) -> UpdateCheckResult {
    let client = match Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(timeout)
        // GitHub redirects API requests when a repository is renamed. Follow a
        // small, bounded number so branded repository moves do not silently
        // break update checks while still preventing redirect loops.
        .redirect(Policy::limited(3))
        .user_agent("Vareliox-Update-Checker")
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return result(
                "invalid_response",
                installed,
                "No se pudo preparar la comprobación.",
                None,
            )
        }
    };
    let response = match client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return result(
                "timeout",
                installed,
                "GitHub tardó demasiado en responder.",
                None,
            )
        }
        Err(error) if error.is_connect() => {
            return result("offline", installed, "No hay conexión con GitHub.", None)
        }
        Err(_) => {
            return result(
                "github_unavailable",
                installed,
                "GitHub no está disponible temporalmente.",
                None,
            )
        }
    };
    if response.status() == StatusCode::NOT_FOUND {
        return result(
            "repository_inaccessible",
            installed,
            "El canal de actualizaciones todavía no está disponible públicamente.",
            None,
        );
    }
    if !response.status().is_success() {
        return result(
            "github_unavailable",
            installed,
            "GitHub no pudo completar la comprobación.",
            None,
        );
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return result(
            "invalid_response",
            installed,
            "GitHub devolvió una respuesta demasiado grande.",
            None,
        );
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            return result(
                "github_unavailable",
                installed,
                "La conexión con GitHub se interrumpió.",
                None,
            );
        };
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return result(
                "invalid_response",
                installed,
                "GitHub devolvió una respuesta demasiado grande.",
                None,
            );
        }
        bytes.extend_from_slice(&chunk);
    }
    match select_release(&bytes, installed, channel) {
        Ok(Some(release)) => result(
            "update_available",
            installed,
            "Hay una nueva versión disponible.",
            Some(release),
        ),
        Ok(None) => result("up_to_date", installed, "Vareliox está actualizado.", None),
        Err(()) => result(
            "invalid_response",
            installed,
            "GitHub devolvió información de versión no válida.",
            None,
        ),
    }
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle, channel: UpdateChannel) -> UpdateCheckResult {
    let installed = app.package_info().version.to_string();
    fetch_releases(RELEASES_API, &installed, channel, Duration::from_secs(8)).await
}

/// Downloads an installer from the official GitHub release and starts it.
/// Windows can run NSIS silently. On macOS the DMG is mounted so the user can
/// drag Vareliox into Applications. Linux packages remain distribution-managed.
#[tauri::command]
pub async fn install_update(app: AppHandle, asset_url: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        let _ = asset_url;
        return Err("La instalación integrada solo está disponible en Windows y macOS.".into());
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let expected_extension = if cfg!(target_os = "windows") {
            ".exe"
        } else {
            ".dmg"
        };
        if !is_official_download_url(&asset_url)
            || !asset_url.to_ascii_lowercase().ends_with(expected_extension)
        {
            return Err("El instalador no pertenece a un release oficial de Vareliox.".into());
        }

        let client = Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(180))
            // GitHub redirects release assets to its signed download host.
            .redirect(Policy::limited(5))
            .user_agent("Vareliox-Updater")
            .build()
            .map_err(|_| "No se pudo preparar la descarga de la actualización.".to_string())?;
        let response = client.get(&asset_url).send().await.map_err(|_| {
            "No se pudo descargar la actualización. Comprueba tu conexión.".to_string()
        })?;
        if !response.status().is_success() {
            return Err("GitHub no pudo entregar el instalador de la actualización.".into());
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_INSTALLER_BYTES)
        {
            return Err("El instalador de la actualización es demasiado grande.".into());
        }

        let target = std::env::temp_dir().join(format!(
            "Vareliox-Update-{}-{}{}",
            app.package_info().version,
            now_millis(),
            expected_extension,
        ));
        let mut file = File::create(&target)
            .map_err(|_| "No se pudo preparar el instalador temporal.".to_string())?;
        let mut received = 0_u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| "La descarga de la actualización se interrumpió.".to_string())?;
            received += chunk.len() as u64;
            if received > MAX_INSTALLER_BYTES {
                let _ = std::fs::remove_file(&target);
                return Err("El instalador de la actualización es demasiado grande.".into());
            }
            if file.write_all(&chunk).is_err() {
                let _ = std::fs::remove_file(&target);
                return Err("No se pudo guardar el instalador de la actualización.".into());
            }
        }
        file.sync_all()
            .map_err(|_| "No se pudo finalizar el instalador de la actualización.".to_string())?;
        drop(file);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut installer = Command::new(&target);
            installer.arg("/S");
            installer.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            installer
                .spawn()
                .map_err(|_| "No se pudo iniciar el instalador de la actualización.".to_string())?;
            app.exit(0);
        }
        #[cfg(target_os = "macos")]
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|_| "No se pudo abrir la imagen de instalación de macOS.".to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn releases_json() -> Vec<u8> {
        br#"[
          {"tag_name":"v9.0.0","name":"Draft","body":"","html_url":"https://github.com/Oliver494/Vareliox-AI/releases/tag/v9.0.0","draft":true,"prerelease":false,"published_at":null,"assets":[]},
          {"tag_name":"v0.1.1","name":"Same","body":"","html_url":"https://github.com/Oliver494/Vareliox-AI/releases/tag/v0.1.1","draft":false,"prerelease":false,"published_at":null,"assets":[]},
          {"tag_name":"v0.2.0-beta.1","name":"Beta","body":"Preview","html_url":"https://github.com/Oliver494/Vareliox-AI/releases/tag/v0.2.0-beta.1","draft":false,"prerelease":true,"published_at":null,"assets":[]},
          {"tag_name":"v0.1.2","name":"Update","body":"Changes","html_url":"https://github.com/Oliver494/Vareliox-AI/releases/tag/v0.1.2","draft":false,"prerelease":false,"published_at":null,"assets":[{"name":"Vareliox_0.1.2_x64-setup.exe","browser_download_url":"https://github.com/Oliver494/Vareliox-AI/releases/download/v0.1.2/Vareliox_0.1.2_x64-setup.exe"}]}
        ]"#.to_vec()
    }

    async fn mock_server(status: &str, body: &[u8], delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let body = body.to_vec();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await;
            tokio::time::sleep(delay).await;
            let headers = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(headers.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        });
        format!("http://{address}/releases")
    }

    async fn redirect_server(target: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await;
            let response = format!(
                "HTTP/1.1 301 Moved Permanently\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        format!("http://{address}/old-repository/releases")
    }

    #[test]
    fn semver_compares_equal_older_and_newer_versions() {
        assert!(parse_version("v0.1.1") == parse_version("0.1.1"));
        assert!(parse_version("0.1.0") < parse_version("0.1.1"));
        assert!(parse_version("0.1.2") > parse_version("0.1.1"));
    }

    #[test]
    fn stable_ignores_prereleases_and_experimental_accepts_them() {
        let stable = select_release(&releases_json(), "0.1.1", UpdateChannel::Stable)
            .unwrap()
            .unwrap();
        let experimental = select_release(&releases_json(), "0.1.1", UpdateChannel::Experimental)
            .unwrap()
            .unwrap();
        assert_eq!(stable.version, "0.1.2");
        assert_eq!(experimental.version, "0.2.0-beta.1");
    }

    #[test]
    fn same_or_older_release_is_not_an_update() {
        assert!(
            select_release(&releases_json(), "0.2.0", UpdateChannel::Stable)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn only_official_release_and_download_urls_are_allowed() {
        assert!(is_official_release_url(
            "https://github.com/Oliver494/Vareliox-AI/releases/tag/v0.1.2"
        ));
        assert!(is_official_download_url("https://github.com/Oliver494/Vareliox-AI/releases/download/v0.1.2/Vareliox_0.1.2_x64-setup.exe"));
        assert!(!is_official_release_url(
            "https://example.com/Oliver494/Vareliox-AI/releases/tag/v0.1.2"
        ));
        assert!(!is_official_download_url(
            "https://github.com/another/repo/releases/download/v1/file.exe"
        ));
    }

    #[test]
    fn selects_the_installer_for_each_operating_system() {
        let release = GitHubRelease {
            tag_name: "v1.0.0".into(),
            name: None,
            body: None,
            html_url: "https://github.com/Oliver494/Vareliox-AI/releases/tag/v1.0.0".into(),
            draft: false,
            prerelease: false,
            published_at: None,
            assets: vec![
                GitHubAsset { name: "Vareliox_1.0.0_x64-setup.exe".into(), browser_download_url: "https://github.com/Oliver494/Vareliox-AI/releases/download/v1.0.0/Vareliox_1.0.0_x64-setup.exe".into() },
                GitHubAsset { name: "Vareliox_1.0.0_amd64.deb".into(), browser_download_url: "https://github.com/Oliver494/Vareliox-AI/releases/download/v1.0.0/Vareliox_1.0.0_amd64.deb".into() },
                GitHubAsset { name: "Vareliox_1.0.0_amd64.AppImage".into(), browser_download_url: "https://github.com/Oliver494/Vareliox-AI/releases/download/v1.0.0/Vareliox_1.0.0_amd64.AppImage".into() },
                GitHubAsset { name: "Vareliox_1.0.0_universal.dmg".into(), browser_download_url: "https://github.com/Oliver494/Vareliox-AI/releases/download/v1.0.0/Vareliox_1.0.0_universal.dmg".into() },
                GitHubAsset { name: "Vareliox_1.0.0_aarch64.dmg".into(), browser_download_url: "https://github.com/Oliver494/Vareliox-AI/releases/download/v1.0.0/Vareliox_1.0.0_aarch64.dmg".into() },
            ],
        };
        assert!(release_asset_url(&release, "windows", "x86_64")
            .unwrap()
            .ends_with(".exe"));
        assert!(release_asset_url(&release, "linux", "x86_64")
            .unwrap()
            .ends_with(".deb"));
        assert!(release_asset_url(&release, "macos", "aarch64")
            .unwrap()
            .ends_with("_universal.dmg"));
        assert!(release_asset_url(&release, "macos", "x86_64")
            .unwrap()
            .ends_with("_universal.dmg"));
        assert!(release_asset_url(&release, "linux", "aarch64").is_none());
    }

    #[tokio::test]
    async fn timeout_finishes_with_a_clear_status() {
        let endpoint = mock_server("200 OK", &releases_json(), Duration::from_millis(100)).await;
        let checked = fetch_releases(
            &endpoint,
            "0.1.1",
            UpdateChannel::Stable,
            Duration::from_millis(10),
        )
        .await;
        assert_eq!(checked.status, "timeout");
    }

    #[tokio::test]
    async fn repository_rename_redirects_are_followed() {
        let target = mock_server("200 OK", &releases_json(), Duration::ZERO).await;
        let endpoint = redirect_server(target).await;
        let checked = fetch_releases(
            &endpoint,
            "0.1.1",
            UpdateChannel::Stable,
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(checked.status, "update_available");
        assert_eq!(checked.release.unwrap().version, "0.1.2");
    }

    #[tokio::test]
    async fn inaccessible_repository_and_invalid_response_are_classified() {
        let missing = mock_server("404 Not Found", b"{}", Duration::ZERO).await;
        assert_eq!(
            fetch_releases(
                &missing,
                "0.1.1",
                UpdateChannel::Stable,
                Duration::from_secs(1)
            )
            .await
            .status,
            "repository_inaccessible"
        );
        let invalid = mock_server("200 OK", b"not-json", Duration::ZERO).await;
        assert_eq!(
            fetch_releases(
                &invalid,
                "0.1.1",
                UpdateChannel::Stable,
                Duration::from_secs(1)
            )
            .await
            .status,
            "invalid_response"
        );
    }
}
