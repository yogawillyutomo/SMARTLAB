#!/usr/bin/env ruby
# frozen_string_literal: true

require 'psych'
require 'set'

contracts_dir = File.expand_path('../packages/contracts', __dir__)
root = File.join(contracts_dir, 'openapi.yaml')
abort 'Canonical OpenAPI root not found.' unless File.file?(root)

queue = [root]
visited = Set.new

until queue.empty?
  path = queue.shift
  next if visited.include?(path)

  begin
    Psych.parse_file(path)
  rescue Psych::SyntaxError => error
    warn "Invalid YAML: #{path}"
    warn error.message
    exit 1
  end

  visited << path
  File.read(path).scan(/\$ref:\s*['"]\.\/([^#'"]+\.yaml)#/) do |match|
    dependency = File.expand_path(match.first, File.dirname(path))
    unless dependency.start_with?(contracts_dir + File::SEPARATOR) && File.file?(dependency)
      warn "Missing or unsafe OpenAPI dependency referenced by #{path}: #{match.first}"
      exit 1
    end
    queue << dependency
  end
end

puts "Canonical OpenAPI YAML syntax valid: #{visited.length} reachable files"
