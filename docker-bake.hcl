variable "TAG" {
  default = "amt-studio-web:0.3.0"
}

group "default" {
  targets = ["multiarch"]
}

target "multiarch" {
  context = "."
  dockerfile = "Dockerfile"
  platforms = ["linux/arm64", "linux/amd64"]
  tags = [TAG]
}
