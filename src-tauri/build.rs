#[path = "build_support/native_command_manifest.rs"]
mod native_command_manifest;

use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo always sets CARGO_MANIFEST_DIR"),
    );
    let source_dir = crate_dir.join("src");
    let generator_source = crate_dir.join("build_support/native_command_manifest.rs");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo always sets OUT_DIR"));

    println!("cargo:rerun-if-changed={}", source_dir.display());
    println!("cargo:rerun-if-changed={}", generator_source.display());

    let registry = native_command_manifest::load_registry(&source_dir)
        .unwrap_or_else(|error| panic!("native command manifest generation failed:\n{error}"));
    native_command_manifest::write_generated_fragments(&registry, &out_dir).unwrap_or_else(
        |error| panic!("could not write generated native command registration:\n{error}"),
    );

    tauri_build::build()
}
