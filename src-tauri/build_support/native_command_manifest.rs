use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub const MANIFEST_FILE_NAME: &str = "command-manifest.txt";
pub const HANDLER_FRAGMENT_NAME: &str = "native_command_handler.rs";
pub const STATE_FRAGMENT_NAME: &str = "native_command_state.rs";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistrationKind {
    Command,
    State,
}

impl RegistrationKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "command" => Some(Self::Command),
            "state" => Some(Self::State),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::State => "state initializer",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registration {
    pub kind: RegistrationKind,
    pub order: u32,
    pub rust_path: String,
    pub cfg: Option<String>,
    pub source: PathBuf,
    pub line: usize,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct NativeCommandRegistry {
    pub commands: Vec<Registration>,
    pub states: Vec<Registration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManifestError(String);

impl fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ManifestError {}

pub fn load_registry(source_dir: &Path) -> Result<NativeCommandRegistry, ManifestError> {
    let mut manifest_paths = Vec::new();
    discover_manifests(source_dir, &mut manifest_paths)?;
    manifest_paths.sort();

    if manifest_paths.is_empty() {
        return Err(ManifestError(format!(
            "no {MANIFEST_FILE_NAME} files found below {}",
            source_dir.display()
        )));
    }

    let mut registrations = Vec::new();
    for manifest_path in manifest_paths {
        registrations.extend(parse_manifest(&manifest_path)?);
    }

    validate_and_sort(registrations)
}

fn discover_manifests(directory: &Path, manifests: &mut Vec<PathBuf>) -> Result<(), ManifestError> {
    let entries = fs::read_dir(directory).map_err(|error| {
        ManifestError(format!(
            "could not scan {} for native command manifests: {error}",
            directory.display()
        ))
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            ManifestError(format!(
                "could not read an entry below {}: {error}",
                directory.display()
            ))
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            ManifestError(format!("could not inspect {}: {error}", path.display()))
        })?;

        if file_type.is_dir() {
            discover_manifests(&path, manifests)?;
        } else if file_type.is_file()
            && path.file_name().and_then(|name| name.to_str()) == Some(MANIFEST_FILE_NAME)
        {
            manifests.push(path);
        }
    }

    Ok(())
}

fn parse_manifest(path: &Path) -> Result<Vec<Registration>, ManifestError> {
    let source = fs::read_to_string(path)
        .map_err(|error| ManifestError(format!("could not read {}: {error}", path.display())))?;
    let mut registrations = Vec::new();

    for (line_index, raw_line) in source.lines().enumerate() {
        let line_number = line_index + 1;
        let line = raw_line.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }

        let fields: Vec<_> = line.split_whitespace().collect();
        if !(3..=4).contains(&fields.len()) {
            return Err(at_line(
                path,
                line_number,
                "expected: <command|state> <order> <crate::rust::path> [cfg(...)]",
            ));
        }

        let kind = RegistrationKind::parse(fields[0])
            .ok_or_else(|| at_line(path, line_number, "entry kind must be `command` or `state`"))?;
        let order = fields[1].parse::<u32>().map_err(|_| {
            at_line(
                path,
                line_number,
                "registration order must be an unsigned integer",
            )
        })?;
        let rust_path = fields[2];
        if !valid_rust_path(rust_path) {
            return Err(at_line(
                path,
                line_number,
                "Rust path must start with `crate::` and contain identifiers separated by `::`",
            ));
        }

        let cfg = fields.get(3).map(|value| (*value).to_owned());
        if let Some(value) = &cfg {
            if !valid_cfg(value) {
                return Err(at_line(
                    path,
                    line_number,
                    "optional condition must use a simple cfg(...) predicate",
                ));
            }
        }

        registrations.push(Registration {
            kind,
            order,
            rust_path: rust_path.to_owned(),
            cfg,
            source: path.to_owned(),
            line: line_number,
        });
    }

    Ok(registrations)
}

fn valid_rust_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("crate::") else {
        return false;
    };
    !rest.is_empty() && rest.split("::").all(valid_identifier)
}

fn valid_identifier(identifier: &str) -> bool {
    let mut chars = identifier.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn valid_cfg(value: &str) -> bool {
    let Some(predicate) = value
        .strip_prefix("cfg(")
        .and_then(|value| value.strip_suffix(')'))
    else {
        return false;
    };
    !predicate.is_empty()
        && predicate
            .chars()
            .all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn validate_and_sort(
    registrations: Vec<Registration>,
) -> Result<NativeCommandRegistry, ManifestError> {
    let mut command_orders = BTreeMap::<u32, Registration>::new();
    let mut state_orders = BTreeMap::<u32, Registration>::new();
    let mut command_paths = HashMap::<String, Registration>::new();
    let mut command_names = HashMap::<String, Registration>::new();
    let mut state_paths = HashMap::<String, Registration>::new();

    for registration in registrations {
        let orders = match registration.kind {
            RegistrationKind::Command => &mut command_orders,
            RegistrationKind::State => &mut state_orders,
        };
        if let Some(previous) = orders.get(&registration.order) {
            return Err(duplicate_error(
                &registration,
                previous,
                &format!(
                    "duplicate {} order {}",
                    registration.kind.label(),
                    registration.order
                ),
            ));
        }

        match registration.kind {
            RegistrationKind::Command => {
                if let Some(previous) = command_paths.get(&registration.rust_path) {
                    return Err(duplicate_error(
                        &registration,
                        previous,
                        "duplicate command path",
                    ));
                }
                let command_name = registration
                    .rust_path
                    .rsplit("::")
                    .next()
                    .expect("a validated Rust path has a final identifier")
                    .to_owned();
                if let Some(previous) = command_names.get(&command_name) {
                    return Err(duplicate_error(
                        &registration,
                        previous,
                        &format!("duplicate public Tauri command name `{command_name}`"),
                    ));
                }
                command_paths.insert(registration.rust_path.clone(), registration.clone());
                command_names.insert(command_name, registration.clone());
            }
            RegistrationKind::State => {
                if let Some(previous) = state_paths.get(&registration.rust_path) {
                    return Err(duplicate_error(
                        &registration,
                        previous,
                        "duplicate state initializer",
                    ));
                }
                state_paths.insert(registration.rust_path.clone(), registration.clone());
            }
        }

        orders.insert(registration.order, registration);
    }

    Ok(NativeCommandRegistry {
        commands: command_orders.into_values().collect(),
        states: state_orders.into_values().collect(),
    })
}

fn duplicate_error(
    current: &Registration,
    previous: &Registration,
    message: &str,
) -> ManifestError {
    at_line(
        &current.source,
        current.line,
        &format!(
            "{message}; first declared at {}:{}",
            previous.source.display(),
            previous.line
        ),
    )
}

fn at_line(path: &Path, line: usize, message: &str) -> ManifestError {
    ManifestError(format!("{}:{line}: {message}", path.display()))
}

pub fn render_handler_expression(registry: &NativeCommandRegistry) -> String {
    let mut output = String::from("tauri::generate_handler![\n");
    for command in &registry.commands {
        if let Some(cfg) = &command.cfg {
            output.push_str(&format!("    #[{cfg}]\n"));
        }
        output.push_str(&format!("    {},\n", command.rust_path));
    }
    output.push_str("]\n");
    output
}

pub fn render_state_initializer(registry: &NativeCommandRegistry) -> String {
    let mut output = String::from("fn initialize_registered_state(app: &tauri::App) {\n");
    for state in &registry.states {
        if let Some(cfg) = &state.cfg {
            output.push_str(&format!("    #[{cfg}]\n"));
        }
        output.push_str(&format!("    {}(app);\n", state.rust_path));
    }
    output.push_str("}\n");
    output
}

pub fn write_generated_fragments(
    registry: &NativeCommandRegistry,
    out_dir: &Path,
) -> Result<(), ManifestError> {
    fs::write(
        out_dir.join(HANDLER_FRAGMENT_NAME),
        render_handler_expression(registry),
    )
    .map_err(|error| ManifestError(format!("could not write handler fragment: {error}")))?;
    fs::write(
        out_dir.join(STATE_FRAGMENT_NAME),
        render_state_initializer(registry),
    )
    .map_err(|error| ManifestError(format!("could not write state fragment: {error}")))?;
    Ok(())
}

// This manifest is deliberately a small, typed-enough source of command paths.
// A future Specta lane can consume the same declarations and extend the optional
// metadata column without changing lib.rs or inventing a second command list.
